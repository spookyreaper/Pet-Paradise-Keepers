const getHomePage = (req, res) => {
  let viewData = {
    title: 'Home'
  };

  if (req.session.userId) {
    viewData.userLoggedIn = true;
  }

  res.render('index', viewData);
};

module.exports = {
    getHomePage,
  };
  