async function getDashboard(req, res) {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.redirect('/login');
    }

    
    const user = await User.findById(userId).populate('pets');
    if (!user) {
      console.error('User not found');
      return res.status(404).send("User not found");
    }

   
    res.render('dashboard', { user: user });
  } catch (err) {
    console.error('Error fetching user from database:', err);
    res.status(500).send("Internal server error");
  }
}
