const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const pet = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Mochi',
  type: 'Cat',
  medicationHistory: 'Daily allergy medication',
  schedule: 'Breakfast at 8 AM',
  photoUrl: 'uploads/owners/507f191e810c19729de860ea/pets/cat.jpg',
};

const user = {
  _id: '507f191e810c19729de860ea',
  username: 'tester',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'Owner',
  role: 'owner',
  biography: 'I care for pets.',
  experience: 'Two years',
  rate: 20,
  profilePhoto: '',
  pets: [pet],
};

function render(template, locals = {}) {
  return ejs.renderFile(path.join(__dirname, '..', 'views', `${template}.ejs`), {
    title: 'Pet Paradise Keepers',
    errorMessage: null,
    role: 'owner',
    user,
    pet,
    pets: [pet],
    ...locals,
  });
}

test('public pages render without an authenticated user', async () => {
  for (const template of ['index', 'login', 'register']) {
    const html = await render(template, { user: null });
    assert.match(html, /<!DOCTYPE html>/i, template);
    assert.doesNotMatch(html, /\bundefined\b/, template);
  }
});

test('owner pages render with populated pets and shared navigation', async () => {
  for (const template of ['completeOwnerInfo', 'addPet', 'editPet', 'viewPets', 'petDetails', 'owner/dashboard', 'owner/profile']) {
    const html = await render(template);
    assert.match(html, /Pet Paradise Keepers/, template);
    assert.doesNotMatch(html, /\bundefined\b/, template);
  }
});

test('sitter pages render with the authenticated sitter', async () => {
  for (const template of ['completeSitterInfo', 'sitter/dashboard', 'sitter/profile']) {
    const html = await render(template, { user: { ...user, role: 'sitter', pets: [] } });
    assert.match(html, /Pet Paradise Keepers/, template);
    assert.doesNotMatch(html, /\bundefined\b/, template);
  }
});

test('the owner dashboard handles both an empty pet list and missing pet photos', async () => {
  const empty = await render('owner/dashboard', { user: { ...user, pets: [] }, pets: [] });
  assert.match(empty, /(?:no pets|not added any pets)/i);
  const noPhoto = await render('owner/dashboard', {
    user: { ...user, pets: [{ ...pet, photoUrl: '' }] },
    pets: [{ ...pet, photoUrl: '' }],
  });
  assert.match(noPhoto, /Mochi/);
  assert.doesNotMatch(noPhoto, /src="(?:undefined|null)"/);
});

test('pet photos use root-relative URLs on dashboard pages', async () => {
  const html = await render('owner/dashboard');
  assert.match(html, /src="\/uploads\/owners\//);
});

test('pet forms submit to registered routes and show saved medical history', async () => {
  const add = await render('addPet');
  assert.match(add, /action="\/pets\/add"/);
  const edit = await render('editPet');
  assert.match(edit, /action="\/pets\/507f1f77bcf86cd799439011\/edit"/);
  assert.match(edit, /action="\/pets\/507f1f77bcf86cd799439011\?_method=DELETE"/);
  assert.match(edit, /Daily allergy medication/);
});

test('profile forms use the correct account deletion route', async () => {
  for (const role of ['owner', 'sitter']) {
    const html = await render(`${role}/profile`, { user: { ...user, role } });
    assert.match(html, new RegExp(`action="/${role}/profile"`));
    assert.match(html, new RegExp(`action="/${role}/profile/delete\\?_method=DELETE"`));
  }
});

test('user-provided names and biographies are escaped in rendered pages', async () => {
  const payload = '<script>alert("unsafe")</script>';
  const html = await render('sitter/dashboard', {
    user: { ...user, role: 'sitter', firstName: payload, biography: payload },
  });
  assert.doesNotMatch(html, /<script>alert\("unsafe"\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('the shared error page can render for guests', async () => {
  const html = await render('error', { user: null, title: 'Page not found', message: 'We could not find that page.' });
  assert.match(html, /Page not found/);
  assert.match(html, /We could not find that page/);
  assert.match(html, /href="\/"/);
});
