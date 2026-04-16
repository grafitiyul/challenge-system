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

/**
 * Phase 4.3: the presentation layer is now centralized into AnalyticsGroup
 * rows. The only piece of per-definition presentation metadata that remains
 * is `analyticsDisplayLabel` (optional shorter label for THIS context). The
 * group FK is validated directly against the AnalyticsGroup table by the
 * create / update methods below.
 */

@Injectable()
export class ContextLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Listing ─────────────────────────────────────────────────────────────
  async list(programId: string, includeArchived = true) {
    return this.prisma.contextDefinition.findMany({
      where: { programId, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      // Phase 4.3: surface the analytics group so the admin list can show the
      // group name inline without a second fetch.
      include: { analyticsGroup: { select: { id: true, label: true } } },
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

    // Phase 4.2 simplified model: the `type` field is no longer admin-choice.
    // Visibility drives everything.
    //   visibleToParticipant  ⇒ inputMode=participant, type=select, options required
    //   !visibleToParticipant ⇒ inputMode=system_fixed, type=text,   fixedValue required
    const isVisibleToParticipant = dto.visibleToParticipantByDefault !== false;
    const type: 'select' | 'text' = isVisibleToParticipant ? 'select' : 'text';
    const inputMode: 'participant' | 'system_fixed' = isVisibleToParticipant
      ? 'participant'
      : 'system_fixed';

    const options = isVisibleToParticipant ? this.buildOptions(dto.options ?? [], []) : null;
    if (isVisibleToParticipant && (!options || options.length === 0)) {
      throw new BadRequestException('הקשר שמוצג למשתתפת חייב לפחות אפשרות אחת');
    }

    let fixedValue: string | null = null;
    if (inputMode === 'system_fixed') {
      const raw = (dto.fixedValue ?? '').trim();
      if (!raw) {
        throw new BadRequestException('הקשר שנקבע על ידי המערכת חייב ערך קבוע');
      }
      fixedValue = raw;
    }

    // Phase 4.3: validate the group FK (if any) belongs to THIS program.
    const analyticsGroupId = await this.resolveGroupId(programId, dto.analyticsGroupId);
    const analyticsDisplayLabel = (dto.analyticsDisplayLabel ?? '').trim() || null;

    const count = await this.prisma.contextDefinition.count({ where: { programId } });
    return this.prisma.contextDefinition.create({
      data: {
        programId,
        label,
        key,
        // Phase 4.2: type is derived from visibility, not admin input.
        type,
        requiredByDefault: dto.requiredByDefault ?? false,
        visibleToParticipantByDefault: dto.visibleToParticipantByDefault ?? true,
        optionsJson: options as unknown as Prisma.InputJsonValue | undefined,
        inputMode,
        analyticsVisible: dto.analyticsVisible ?? true,
        fixedValue,
        analyticsGroupId,
        analyticsDisplayLabel,
        sortOrder: count,
      },
    });
  }

  /**
   * Resolve a group-id field from a DTO input. Empty string / null / undefined
   * all collapse to null (clear assignment). A non-empty value must reference
   * an AnalyticsGroup row in the same program, otherwise 400.
   */
  private async resolveGroupId(
    programId: string,
    raw: string | null | undefined,
  ): Promise<string | null> {
    if (raw === undefined) return null;
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    const group = await this.prisma.analyticsGroup.findUnique({
      where: { id: trimmed },
      select: { id: true, programId: true },
    });
    if (!group) throw new NotFoundException(`Analytics group ${trimmed} not found`);
    if (group.programId !== programId) {
      throw new BadRequestException('Analytics group belongs to a different program');
    }
    return group.id;
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

    // Phase 4.2 simplified model: the RESULTING visibility decides the
    // inputMode + type + whether options are required.
    const nextVisible =
      dto.visibleToParticipantByDefault !== undefined
        ? dto.visibleToParticipantByDefault
        : row.visibleToParticipantByDefault;
    const nextInputMode: 'participant' | 'system_fixed' = nextVisible
      ? 'participant'
      : 'system_fixed';
    patch.inputMode = nextInputMode;
    if (nextVisible) patch.type = 'select';
    else patch.type = 'text';
    if (dto.analyticsVisible !== undefined) patch.analyticsVisible = dto.analyticsVisible;

    let nextOptions: StoredContextOption[] | null = null;
    if (nextVisible) {
      // Participant-visible → must have options after save.
      if (dto.options !== undefined) {
        const prevOptions =
          (row.optionsJson as unknown as StoredContextOption[] | null) ?? [];
        nextOptions = this.buildOptions(dto.options, prevOptions);
      } else {
        nextOptions = (row.optionsJson as unknown as StoredContextOption[] | null) ?? [];
      }
      if (nextOptions.length === 0) {
        throw new BadRequestException('הקשר שמוצג למשתתפת חייב לפחות אפשרות אחת');
      }
      patch.optionsJson = nextOptions as unknown as Prisma.InputJsonValue;
    } else {
      // System context never has participant-facing options; clear them.
      patch.optionsJson = Prisma.JsonNull;
    }

    if (nextInputMode === 'system_fixed') {
      const candidate: string | null =
        dto.fixedValue !== undefined
          ? (dto.fixedValue ?? '').trim() || null
          : row.fixedValue ?? null;
      if (!candidate) {
        throw new BadRequestException('הקשר שנקבע על ידי המערכת חייב ערך קבוע');
      }
      patch.fixedValue = candidate;
    } else {
      // Participant → fixedValue is meaningless; drop it if present.
      patch.fixedValue = null;
    }

    // Phase 4.3: centralized group FK. `analyticsGroupId === ""` or null
    // clears the assignment; a non-empty value must reference a group in this
    // program. `analyticsDisplayLabel` stays a simple per-definition override.
    if (dto.analyticsGroupId !== undefined) {
      const nextGroupId = await this.resolveGroupId(row.programId, dto.analyticsGroupId);
      patch.analyticsGroup = nextGroupId
        ? { connect: { id: nextGroupId } }
        : { disconnect: true };
    }
    if (dto.analyticsDisplayLabel !== undefined) {
      patch.analyticsDisplayLabel =
        (dto.analyticsDisplayLabel ?? '').trim() || null;
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
