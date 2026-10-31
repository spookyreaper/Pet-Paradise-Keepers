const fs = require('node:fs/promises');
const path = require('node:path');

const uploadsDirectory = path.resolve(__dirname, '../public/uploads');

function uploadedPhoto(file) {
  if (!file) return '';
  const relative = path.relative(uploadsDirectory, path.resolve(file.path));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid upload path');
  }
  return `/uploads/${relative.split(path.sep).join('/')}`;
}

async function removeStoredPhoto(photoUrl) {
  if (typeof photoUrl !== 'string') return;
  const normalized = photoUrl.replace(/^\/+/, '').replace(/^public\//, '');
  if (!normalized.startsWith('uploads/')) return;
  const file = path.resolve(uploadsDirectory, normalized.slice('uploads/'.length));
  const relative = path.relative(uploadsDirectory, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  try {
    await fs.unlink(file);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to remove old photo:', error.message);
  }
}

async function removeAccountUploads(user) {
  const userId = String(user._id);
  if (!/^[a-f0-9]{24}$/i.test(userId) || !['owner', 'sitter'].includes(user.role)) return;
  const category = user.role === 'owner' ? 'owners' : 'sitters';
  try {
    await fs.rm(path.join(uploadsDirectory, category, userId), { recursive: true, force: true });
  } catch (error) {
    console.error('Unable to remove account photos:', error.message);
  }
}

async function discardUploads(req) {
  const files = [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean);
  await Promise.all(files.map(async file => {
    const relative = path.relative(uploadsDirectory, path.resolve(file.path));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    try {
      await fs.unlink(file.path);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Unable to remove discarded upload:', error.message);
    }
  }));
}

module.exports = { uploadedPhoto, discardUploads, removeStoredPhoto, removeAccountUploads };
