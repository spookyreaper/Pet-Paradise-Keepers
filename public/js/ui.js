document.querySelectorAll('[data-password-toggle]').forEach(button => {
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  button.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  });
});

document.querySelectorAll('[data-image-input]').forEach(input => {
  const preview = document.getElementById(input.dataset.imageInput);
  if (!preview) return;
  const originalSource = preview.getAttribute('src');
  const originallyHidden = preview.hidden;
  let objectUrl;
  input.addEventListener('change', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = input.files[0];
    const allowed = file && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
    const error = file && !allowed ? 'Choose a JPG, PNG, GIF, or WebP photo.'
      : file && file.size > 5 * 1024 * 1024 ? 'Choose a photo that is 5 MB or smaller.' : '';
    input.setCustomValidity(error);
    if (error) input.reportValidity();
    if (!file || error) {
      if (originalSource) preview.src = originalSource;
      else preview.removeAttribute('src');
      preview.hidden = originallyHidden;
      return;
    }
    objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    preview.hidden = false;
  });
});

document.querySelectorAll('.user-dropdown').forEach(menu => {
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
});
