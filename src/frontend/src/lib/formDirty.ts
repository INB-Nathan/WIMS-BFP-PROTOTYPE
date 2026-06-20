/**
 * Simple module-level singleton that tracks whether any form in the app has
 * unsaved changes. Components set this flag on first user edit and clear it
 * on successful save / submit. The Sidebar reads it before navigating so it
 * can show a confirmation dialog.
 */

let _dirty = false;

export function setFormDirty(value: boolean): void {
  _dirty = value;
}

export function isFormDirty(): boolean {
  return _dirty;
}
