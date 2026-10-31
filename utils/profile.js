const bcrypt = require('bcrypt');
const Account = require('../models/accountSchema');
const { discardUploads } = require('./upload');

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function textField(body, field, label, required = false) {
  const value = body[field];
  if (value !== undefined && typeof value !== 'string') {
    throw inputError(`${label} must be text.`);
  }
  const text = (value || '').trim();
  if (required && !text) throw inputError(`${label} is required.`);
  return text;
}

function sitterInfo(body, required = false) {
  const biography = textField(body, 'biography', 'Biography', required);
  const experience = textField(body, 'experience', 'Experience', required);
  const rateInput = body.rate;
  if ((typeof rateInput !== 'string' && typeof rateInput !== 'number') || String(rateInput).trim() === '') {
    throw inputError('Enter an hourly rate of zero or more.');
  }
  const rate = Number(rateInput);
  if (!Number.isFinite(rate) || rate < 0) {
    throw inputError('Enter an hourly rate of zero or more.');
  }
  return { biography, experience, rate };
}

async function assertProfileEmailAvailable(user, email) {
  if (email === user.email) return;
  const existing = await Account.exists({ _id: { $ne: user._id }, username: email });
  if (existing) {
    throw inputError('That email address is already used as another account\'s username. Choose a different email address.', 409);
  }
}

async function profileUpdates(user, body, isSitter = false) {
  const updates = {
    firstName: textField(body, 'firstName', 'First name', true),
    lastName: textField(body, 'lastName', 'Last name', true),
    email: textField(body, 'email', 'Email', true).toLowerCase(),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    throw inputError('Enter a valid email address.');
  }
  if (isSitter) Object.assign(updates, sitterInfo(body));

  const fields = ['currentPassword', 'newPassword', 'confirmNewPassword'];
  const passwords = fields.map(field => {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      throw inputError('Password fields must be text.');
    }
    return body[field] || '';
  });
  if (passwords.some(Boolean)) {
    const [currentPassword, newPassword, confirmation] = passwords;
    if (!passwords.every(Boolean)) {
      throw inputError('Enter your current password, new password, and password confirmation.');
    }
    if (newPassword !== confirmation) throw inputError('New passwords do not match.');
    if (newPassword.length < 6 || Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw inputError('Use a password of at least 6 characters and no more than 72 bytes.');
    }
    if (!await bcrypt.compare(currentPassword, user.password)) {
      throw inputError('Current password is incorrect.');
    }
    if (newPassword === currentPassword) {
      throw inputError('New password must be different from the current password.');
    }
    updates.password = await bcrypt.hash(newPassword, 12);
  }
  return updates;
}

async function formError(req, res, next, error, template, user) {
  await discardUploads(req);
  let status = error.status;
  let message = error.message;
  if (error.code === 11000) {
    status = 409;
    message = 'That email address is already in use.';
  } else if (error.name === 'ValidationError' || error.name === 'CastError') {
    status = 400;
    message = error.name === 'ValidationError'
      ? Object.values(error.errors).map(item => item.message).join(' ')
      : 'Please check your profile information.';
  }
  if (status !== 400 && status !== 409) return next(error);

  const values = user && typeof user.toObject === 'function' ? user.toObject() : { ...user };
  for (const field of ['firstName', 'lastName', 'email', 'biography', 'experience', 'rate']) {
    if (typeof req.body[field] === 'string') values[field] = req.body[field];
  }
  const petValues = {};
  for (const field of ['petName', 'petType', 'petMedicalHistory']) {
    if (typeof req.body[field] === 'string') petValues[field] = req.body[field];
  }
  return res.status(status).render(template, { user: values, values: petValues, errorMessage: message });
}

module.exports = { inputError, textField, sitterInfo, assertProfileEmailAvailable, profileUpdates, formError };
