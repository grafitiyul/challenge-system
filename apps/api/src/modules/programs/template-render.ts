// Shared template variable substitution. Used by the admin compose
// (preview) flow and any future auto-send. Unknown vars are left as-is
// so admin sees them and can fix the source template.
//
// Supported vars:
//   {firstName} {lastName} {fullName} {phoneNumber} {email}
//   {productTitle} {offerTitle} {offerAmount} {offerCurrency}
//   {groupName} {gameLink} {tasksLink} {portalLink}
//
// Link variables:
//   {gameLink}   — full URL to the game portal  (/t/:token)
//   {tasksLink}  — full URL to the tasks portal (/tg/:token)
//   {portalLink} — legacy alias of {tasksLink}, kept so old templates
//                  keep rendering. Hidden from the variable bar.

export interface TemplateContext {
  participant?: {
    firstName: string;
    lastName?: string | null;
    phoneNumber: string;
    email?: string | null;
  } | null;
  product?: { title: string } | null;
  offer?: { title: string; amount: string | number; currency: string } | null;
  group?: { name: string } | null;
  gameLink?: string | null;
  tasksLink?: string | null;
  portalLink?: string | null;
}

export function renderTemplate(body: string, ctx: TemplateContext): string {
  const vars: Record<string, string> = {};
  if (ctx.participant) {
    vars.firstName = ctx.participant.firstName ?? '';
    vars.lastName = ctx.participant.lastName ?? '';
    vars.fullName = [ctx.participant.firstName, ctx.participant.lastName].filter(Boolean).join(' ');
    vars.phoneNumber = ctx.participant.phoneNumber ?? '';
    vars.email = ctx.participant.email ?? '';
  }
  if (ctx.product) vars.productTitle = ctx.product.title;
  if (ctx.offer) {
    vars.offerTitle = ctx.offer.title;
    vars.offerAmount = String(ctx.offer.amount);
    vars.offerCurrency = ctx.offer.currency;
  }
  if (ctx.group) vars.groupName = ctx.group.name;
  if (ctx.gameLink) vars.gameLink = ctx.gameLink;
  if (ctx.tasksLink) vars.tasksLink = ctx.tasksLink;
  if (ctx.portalLink) vars.portalLink = ctx.portalLink;

  return body.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

export const TEMPLATE_VARIABLE_KEYS = [
  'firstName', 'lastName', 'fullName', 'phoneNumber', 'email',
  'productTitle', 'offerTitle', 'offerAmount', 'offerCurrency',
  'groupName', 'gameLink', 'tasksLink', 'portalLink',
] as const;
