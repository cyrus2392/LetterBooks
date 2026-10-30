<script>
  // A Font Awesome icon (from @fortawesome/free-solid-svg-icons) as inline
  // SVG in the current text colour, sized to the text unless `size` is given.
  // Decorative by default; pass `label` when the icon carries meaning alone.
  let { icon, size = '1em', label = null } = $props();
  const [width, height, , , path] = $derived(icon.icon);
</script>

<svg
  class="icon"
  viewBox="0 0 {width} {height}"
  width={size}
  height={size}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <path fill="currentColor" d={Array.isArray(path) ? path.join(' ') : path} />
</svg>

<style>
  .icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: -0.125em;
  }
</style>
