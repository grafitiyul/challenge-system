import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ContextDefinitionOptionDto,
  CreateContextDefinitionDto,
  UpdateContextDefinitionDto,
} from './dto/context-definition.dto';
import { makeUniqueKey, slugifyLabel } from './context-validation';

/**
 * Phase 3.2 — Reusable context library service.
 *
 * Shape contract:
 *   - `key` is auto-derived from `label`, unique per program, stable across edits.
 *   - For `select` definitions, each option also gets a stable auto-slug `value`.
 *   - Options are stored as a JSON array on the row (not a separate table) —
 *     keeps writes atomic and read paths simple. Historical participant data
 *     references option values, not option IDs, so removing an option doesn't
 *     break past log rows (they still resolve to the raw stored value label).
 *   - Archiving (`isActive=false`) hides a definition from attachment pickers
 *     but keeps existing attachments and historical logs intact.
 *
 * Nothing here mutates `GameAction.contextSchemaJson` — the local-only schema
 * remains untouched for backward compat. Resolution (see game-engine.service)
 * merges both layers at participant read time.
 */

export interface StoredContextOption {
  value: string;
  label: string;
}

@Injectable()
export class ContextLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Listing ─────────────────────────────────────────────────────────────
  async list(programId: string, includeArchived = true) {
    return this.prisma.contextDefinition.findMany({
      where: { programId, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.contextDefinition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Context definition ${id} not found`);
    return row;
  }

  // ─── Create ──────────────────────────────────────────────────────────────
  async create(programId: string, dto: CreateContextDefinitionDto) {
    const label = dto.label?.trim();
    if (!label) throw new BadRequestException('Label is required');

    const existing = await this.prisma.contextDefinition.findMany({
      where: { programId },
      select: { key: true },
    });
    const taken = new Set(existing.map((r) => r.key));
    const key = makeUniqueKey(slugifyLabel(label), taken);

    const options =
      dto.type === 'select' ? this.buildOptions(dto.options ?? [], []) : null;
    if (dto.type === 'select' && (!options || options.length === 0)) {
      throw new BadRequestException('A select context must have at least one option');
    }

    // Phase 3.3 behavior model. system_fixed requires a concrete fixedValue
    // (otherwise the "system" would have nothing to inject on submission).
    // When inputMode is participant, any fixedValue is quietly blanked — it's
    // irrelevant and keeping it would mislead readers of the stored row.
    const inputMode: 'participant' | 'system_fixed' = dto.inputMode ?? 'participant';
    let fixedValue: string | null = null;
    if (inputMode === 'system_fixed') {
      const raw = (dto.fixedValue ?? '').trim();
      if (!raw) {
        throw new BadRequestException(
          'inputMode=system_fixed requires a non-empty fixedValue',
        );
      }
      // For select dimensions, the fixedValue must match one of the option values.
      if (dto.type === 'select') {
        const valid = (options ?? []).some((o) => o.value === raw);
        if (!valid) {
          throw new BadRequestException(
            `fixedValue "${raw}" does not match any option value`,
          );
        }
      }
      fixedValue = raw;
    }

    const count = await this.prisma.contextDefinition.count({ where: { programId } });
    return this.prisma.contextDefinition.create({
      data: {
        programId,
        label,
        key,
        type: dto.type,
        requiredByDefault: dto.requiredByDefault ?? false,
        visibleToParticipantByDefault: dto.visibleToParticipantByDefault ?? true,
        optionsJson: options as unknown as Prisma.InputJsonValue | undefined,
        inputMode,
        analyticsVisible: dto.analyticsVisible ?? true,
        fixedValue,
        sortOrder: count,
      },
    });
  }

  // ─── Update ──────────────────────────────────────────────────────────────
  async update(id: string, dto: UpdateContextDefinitionDto) {
    const row = await this.get(id);
    const patch: Prisma.ContextDefinitionUpdateInput = {};
    if (dto.label !== undefined) {
      const nextLabel = dto.label.trim();
      if (!nextLabel) throw new BadRequestException('Label cannot be empty');
      patch.label = nextLabel;
    }
    if (dto.requiredByDefault !== undefined) patch.requiredByDefault = dto.requiredByDefault;
    if (dto.visibleToParticipantByDefault !== undefined) {
      patch.visibleToParticipantByDefault = dto.visibleToParticipantByDefault;
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    // Phase 3.3 behavior. We have to know the RESULTING inputMode + options to
    // decide whether fixedValue is required and well-formed — peek at the new
    // dto values, fall back to stored row values.
    const nextInputMode: 'participant' | 'system_fixed' =
      dto.inputMode ?? (row.inputMode as 'participant' | 'system_fixed');
    if (dto.inputMode !== undefined) patch.inputMode = dto.inputMode;
    if (dto.analyticsVisible !== undefined) patch.analyticsVisible = dto.analyticsVisible;

    let nextOptions: StoredContextOption[] | null = null;
    if (dto.options !== undefined) {
      if (row.type !== 'select') {
        throw new BadRequestException('Only select definitions accept options');
      }
      const prevOptions =
        (row.optionsJson as unknown as StoredContextOption[] | null) ?? [];
      nextOptions = this.buildOptions(dto.options, prevOptions);
      if (nextOptions.length === 0) {
        throw new BadRequestException('A select context must have at least one option');
      }
      patch.optionsJson = nextOptions as unknown as Prisma.InputJsonValue;
    }

    // Resolve fixedValue against nextInputMode.
    // - Switching to system_fixed: dto.fixedValue required unless stored row already has one AND it's still valid.
    // - Staying participant: blank out any fixedValue (avoid stale meaningless data).
    const effectiveOptions =
      nextOptions ??
      (row.optionsJson as unknown as StoredContextOption[] | null);
    if (nextInputMode === 'system_fixed') {
      let candidate: string | null = dto.fixedValue !== undefined
        ? (dto.fixedValue ?? '').trim() || null
        : row.fixedValue ?? null;
      if (!candidate) {
        throw new BadRequestException(
          'inputMode=system_fixed requires a non-empty fixedValue',
        );
      }
      if (row.type === 'select') {
        const valid = (effectiveOptions ?? []).some((o) => o.value === candidate);
        if (!valid) {
          throw new BadRequestException(
            `fixedValue "${candidate}" does not match any option value`,
          );
        }
      }
      patch.fixedValue = candidate;
    } else {
      // nextInputMode === 'participant'. If we're switching away from system_fixed
      // OR the admin explicitly changed to participant, clear the now-meaningless
      // fixedValue. Otherwise honor an explicit clear request from the admin.
      if (dto.inputMode === 'participant' || row.inputMode === 'system_fixed') {
        patch.fixedValue = null;
      } else if (dto.fixedValue !== undefined) {
        patch.fixedValue = dto.fixedValue.trim() || null;
      }
    }

    return this.prisma.contextDefinition.update({ where: { id }, data: patch });
  }

  // ─── Archive / restore ───────────────────────────────────────────────────
  // Archiving never touches existing uses. Historical data keeps resolving.
  async archive(id: string) {
    await this.get(id);
    return this.prisma.contextDefinition.update({
      where: { id },
      data: { isActive: false },
    });
  }
  async restore(id: string) {
    await this.get(id);
    return this.prisma.contextDefinition.update({
      where: { id },
      data: { isActive: true },
    });
  }

  // ─── Attach to / detach from an action (from the context side) ──────────
  // Mirror of the action-editor's attachment flow. Useful when an admin is
  // editing a context and wants to hook it up to multiple actions without
  // bouncing between screens. Per-use overrides stay in the action editor.
  // These endpoints never create or delete definitions — only the attachment
  // row (GameActionContextUse).

  async attachToAction(definitionId: string, actionId: string) {
    const def = await this.get(definitionId);
    const action = await this.prisma.gameAction.findUnique({
      where: { id: actionId },
      select: { id: true, programId: true },
    });
    if (!action) throw new NotFoundException(`Action ${actionId} not found`);
    if (action.programId !== def.programId) {
      throw new BadRequestException('Action belongs to a different program');
    }
    // Upsert keeps attach idempotent. Sort order appends the row at the end
    // of whatever's already attached to that action.
    const existing = await this.prisma.gameActionContextUse.findUnique({
      where: { actionId_definitionId: { actionId, definitionId } },
    });
    if (existing) return existing;
    const trailing = await this.prisma.gameActionContextUse.count({ where: { actionId } });
    return this.prisma.gameActionContextUse.create({
      data: {
        actionId,
        definitionId,
        sortOrder: trailing,
      },
    });
  }

  async detachFromAction(definitionId: string, actionId: string) {
    const result = await this.prisma.gameActionContextUse.deleteMany({
      where: { actionId, definitionId },
    });
    return { detached: result.count };
  }

  async listAttachedActions(definitionId: string) {
    await this.get(definitionId); // validate
    const uses = await this.prisma.gameActionContextUse.findMany({
      where: { definitionId },
      include: { action: { select: { id: true, name: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return uses
      .filter((u) => u.action.isActive)
      .map((u) => ({ id: u.action.id, name: u.action.name }));
  }

  // ─── Reorder ─────────────────────────────────────────────────────────────
  async reorder(programId: string, items: { id: string; sortOrder: number }[]) {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.contextDefinition.update({
          where: { id: item.id, programId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  /**
   * Build the stored option list from admin input.
   * - Labels are trimmed + required.
   * - Values: reuse the existing value if the admin re-sent it; otherwise
   *   auto-slugify the label. Auto-slug dodges collisions against values
   *   already present in this round and against previously stored values
   *   (so removed-then-re-added options don't recycle an identifier that
   *   historical log rows still point at).
   */
  private buildOptions(
    input: ContextDefinitionOptionDto[],
    previous: StoredContextOption[],
  ): StoredContextOption[] {
    const seenLabels = new Set<string>();
    const takenValues = new Set(previous.map((o) => o.value));
    const out: StoredContextOption[] = [];
    for (const raw of input) {
      const label = raw.label?.trim();
      if (!label) throw new BadRequestException('Each option needs a label');
      if (seenLabels.has(label)) {
        throw new BadRequestException(`Duplicate option label: "${label}"`);
      }
      seenLabels.add(label);
      let value = raw.value?.trim();
      if (!value) {
        value = makeUniqueKey(slugifyLabel(label), takenValues);
      }
      // Still dodge collisions within this save cycle.
      while (takenValues.has(value) && !previous.find((o) => o.value === value)) {
        value = makeUniqueKey(value, takenValues);
      }
      takenValues.add(value);
      out.push({ value, label });
    }
    return out;
  }
}
