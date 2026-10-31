const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const extensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination(req, file, callback) {
    const userId = req.user ? String(req.user._id) : req.session?.userId;
    const role = req.user ? req.user.role : req.session?.role;
    if (!/^[a-f0-9]{24}$/i.test(userId || '') || !['owner', 'sitter'].includes(role)) {
      const error = new Error('Please log in before uploading a photo.');
      error.status = 401;
      return callback(error);
    }
    const category = role === 'owner' ? 'owners' : 'sitters';
    const directory = path.resolve(__dirname, '../public/uploads', category, userId);
    fs.mkdir(directory, { recursive: true }, error => callback(error, directory));
  },
  filename(req, file, callback) {
    callback(null, `${randomUUID()}${extensions[file.mimetype]}`);
  },
});

module.exports = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 30 },
  fileFilter(req, file, callback) {
    if (extensions[file.mimetype]) return callback(null, true);
    const error = new Error('Please upload a JPEG, PNG, GIF, or WebP photo.');
    error.status = 400;
    return callback(error);
  },
});
