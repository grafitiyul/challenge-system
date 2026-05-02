import React from 'react';

// Recognizable WhatsApp glyph — phone inside a chat bubble. Used
// everywhere a private/group WhatsApp action exists in admin UI:
// participant profile chat tab, group participant-list WA button,
// group header broadcast button. Sized via the `size` prop; color via
// `color` (defaults to currentColor so a parent button's color
// cascades through). Kept brand-recognizable on purpose so admins can
// spot WhatsApp surfaces at a glance.

export function WhatsAppIcon({
  size = 18,
  color = 'currentColor',
}: {
  size?: number;
  color?: string;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39a.63.63 0 01-.315-.1c-.802-.402-1.504-.817-2.163-1.447-.545-.516-1.146-1.29-1.46-1.963a.426.426 0 01-.073-.215c0-.33.99-.945.99-1.49 0-.143-.73-2.09-.832-2.335-.143-.372-.214-.487-.6-.487-.187 0-.36-.043-.53-.043-.302 0-.53.115-.746.315-.688.645-1.032 1.318-1.06 2.264v.114c-.015.99.472 1.977 1.017 2.78 1.23 1.82 2.506 3.41 4.554 4.34.616.287 2.035.876 2.722.876.69 0 1.853-.43 2.18-1.08.2-.4.2-.745.143-1.175-.058-.143-1.806-1.044-2.336-1.044zM16.176 26.22c-1.864 0-3.66-.55-5.21-1.557l-3.66 1.166 1.187-3.51c-1.13-1.61-1.728-3.531-1.728-5.51 0-5.347 4.350-9.696 9.412-9.696 5.062 0 9.412 4.349 9.412 9.696 0 5.347-4.350 9.412-9.412 9.412zm0-21.108c-6.428 0-11.696 5.268-11.696 11.696 0 2.063.547 4.094 1.585 5.876l-2.064 6.142 6.347-2.044c1.7.93 3.638 1.466 5.829 1.466 6.428 0 11.696-5.268 11.696-11.696 0-6.428-5.268-11.696-11.696-11.696z"/>
    </svg>
  );
}
