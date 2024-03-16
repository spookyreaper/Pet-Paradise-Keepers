const Account = require('../models/accountSchema');


function getCompleteSitterInfo(req, res) {
  
  const user = req.session.user;
  res.render('completeSitterInfo', { user: user });
}

async function postCompleteSitterInfo(req, res) {
    try {
      const sitterId = req.session.userId;
      const { biography, experience, rate } = req.body;
      const profilePhoto = req.file ? req.file.path.replace('public', '') : '';
  

      const updatedSitter = await Account.findByIdAndUpdate(sitterId, {
        biography,
        experience,
        rate,
        profilePhoto
      }, { new: true });
  
      res.redirect('/dashboard');
    } catch (error) {
      console.error('Error updating sitter info:', error);
      res.status(500).send('An error occurred while updating sitter information.');
    }
  }

module.exports = {
  getCompleteSitterInfo,
  postCompleteSitterInfo,
};
