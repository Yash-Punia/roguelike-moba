/** A labelled row of toggle buttons, one of them on (menus and settings). */
export function Segments<T extends string | number>(props: { label: string; options: { value: T; text: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <fieldset class="menu-field">
      <legend>{props.label}</legend>
      <div class="menu-segments">
        {props.options.map((o) => (
          <button type="button" key={o.value} class={o.value === props.value ? 'on' : ''} aria-pressed={o.value === props.value} onClick={() => props.onPick(o.value)}>
            {o.text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
