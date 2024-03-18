// middlewares/uploadConfig.js
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const storage = multer.diskStorage({
  destination: function(req, file, callback) {
    let dir;
    if (req.session.role === 'owner') {
      const ownerId = req.session.userId;
      dir = `public/uploads/owners/${ownerId}/pets`;
    } else if (req.session.role === 'sitter') {
      const sitterId = req.session.userId;
      dir = `public/uploads/sitters/${sitterId}`;
    }

    fs.exists(dir, exist => {
      if (!exist) {
        return fs.mkdir(dir, { recursive: true }, error => callback(error, dir));
      }
      return callback(null, dir);
    });
  },
  filename: function(req, file, callback) {
    const filename = `${Date.now()}${path.extname(file.originalname)}`;
    callback(null, filename);
  }
});

const upload = multer({ storage: storage });

module.exports = upload;
