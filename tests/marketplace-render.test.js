const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const owner = {
  _id: '507f191e810c19729de860ea', role: 'owner', firstName: 'Sam', lastName: 'Owner',
  email: 'PRIVATE_OWNER_EMAIL@example.com', profilePhoto: '', pets: [],
};
const sitter = {
  _id: '507f191e810c19729de860eb', role: 'sitter', firstName: 'Robin', lastName: 'Sitter',
  email: 'PRIVATE_SITTER_EMAIL@example.com', profilePhoto: 'public/uploads/sitters/robin.png',
  biography: 'I enjoy caring for cats.', experience: 'Five years of pet care.', rate: 24.5,
};
const pet = {
  _id: '507f1f77bcf86cd799439011', name: 'Mochi', type: 'Cat',
  photoUrl: 'public/uploads/owners/sam/cat.png', medicationHistory: 'PRIVATE_MEDICAL_HISTORY',
};
const fixtureYear = new Date().getUTCFullYear() + 1;
const job = {
  _id: '507f1f77bcf86cd799439012', owner, pet, title: 'A day of care for Mochi',
  description: 'Please share a quiet afternoon with Mochi.', location: 'Brooklyn',
  startDate: new Date(`${fixtureYear}-10-20T14:00:00Z`), endDate: new Date(`${fixtureYear}-10-20T18:00:00Z`),
  budget: 25, status: 'open',
};

function render(view, values = {}) {
  return ejs.renderFile(path.join(__dirname, '..', 'views', `${view}.ejs`), {
    user: owner, errorMessage: null, ...values,
  });
}

function assertPrivateDetailsHidden(html) {
  for (const privateValue of ['PRIVATE_MEDICAL_HISTORY', 'PRIVATE_OWNER_EMAIL', 'PRIVATE_SITTER_EMAIL']) {
    assert.equal(html.includes(privateValue), false, privateValue);
  }
}

test('owners see their own job listings while sitters see the available board', async () => {
  const own = await render('marketplace/jobs', {
    jobs: [{ ...job, title: 'Another owner listing' }], ownJobs: [job],
  });
  assert.match(own, /My sitting jobs/);
  assert.match(own, /A day of care for Mochi/);
  assert.doesNotMatch(own, /Another owner listing/);
  assert.match(own, /href="\/jobs\/new"/);
  assertPrivateDetailsHidden(own);

  const board = await render('marketplace/jobs', { user: sitter, jobs: [job], ownJobs: [] });
  assert.match(board, /Find sitting jobs/);
  assert.match(board, /10:00\sAM\sEDT/);
  assert.match(board, /2:00\sPM\sEDT/);
  assert.match(board, /src="\/uploads\/owners\/sam\/cat.png"/);
  assertPrivateDetailsHidden(board);
});

test('empty job boards provide role-specific next actions', async () => {
  const own = await render('marketplace/jobs', { jobs: [], ownJobs: [] });
  assert.match(own, /Post my first job/);
  const board = await render('marketplace/jobs', { user: sitter, jobs: [] });
  assert.match(board, /Nothing open just yet/);
  assert.match(board, /Review my sitter profile/);
});

test('sitter search preserves filters, shows real rates, and keeps private fields hidden', async () => {
  const html = await render('marketplace/sitters', {
    sitters: [sitter], filters: { q: 'cats', maxRate: '25.00' },
    pagination: { page: 1, pages: 2, next: '/sitters?q=cats&maxRate=25.00&page=2' },
  });
  assert.match(html, /value="cats"/);
  assert.match(html, /value="25.00"/);
  assert.match(html, /\$24.50/);
  assert.match(html, /href="\/sitters\/507f191e810c19729de860eb\/request"/);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /href="\/sitters\?q=cats&amp;maxRate=25.00&amp;page=2"/);
  assertPrivateDetailsHidden(html);
});

test('a sitter profile offers interview and private-message links without contact details', async () => {
  const html = await render('marketplace/sitter', { sitter });
  assert.match(html, /Five years of pet care/);
  assert.match(html, /src="\/uploads\/sitters\/robin.png"/);
  assert.match(html, /href="\/sitters\/507f191e810c19729de860eb\/request"/);
  assert.match(html, /href="\/messages\/new\?recipient=507f191e810c19729de860eb"/);
  assertPrivateDetailsHidden(html);
});

test('job details expose the right actions for the viewer and listing status', async () => {
  const active = await render('marketplace/job', { user: sitter, job, isOwner: false });
  assert.match(active, /href="\/jobs\/507f1f77bcf86cd799439012\/request"/);
  assert.match(active, /href="\/messages\/new\?recipient=507f191e810c19729de860ea"/);
  assert.doesNotMatch(active, /action="\/jobs\/507f1f77bcf86cd799439012\/close"/);
  assertPrivateDetailsHidden(active);

  const closed = await render('marketplace/job', { user: sitter, job: { ...job, status: 'closed' }, isOwner: false });
  assert.match(closed, /This listing is closed/);
  assert.doesNotMatch(closed, /href="\/jobs\/507f1f77bcf86cd799439012\/request"/);
  const expired = await render('marketplace/job', {
    user: sitter, job: { ...job, endDate: new Date(Date.now() - 1000) }, isOwner: false,
  });
  assert.match(expired, /Listing has ended/);
  assert.doesNotMatch(expired, /href="\/jobs\/507f1f77bcf86cd799439012\/request"/);

  const own = await render('marketplace/job', { job, isOwner: true });
  assert.match(own, /action="\/jobs\/507f1f77bcf86cd799439012\/close" method="post"/);
  assert.match(own, /href="\/jobs\/507f1f77bcf86cd799439012\/edit"/);
  assert.doesNotMatch(own, /Apply for this job/);
  const closedOwn = await render('marketplace/job', { job: { ...job, status: 'closed' }, isOwner: true });
  assert.doesNotMatch(closedOwn, /href="\/jobs\/507f1f77bcf86cd799439012\/edit"/);
  const closedList = await render('marketplace/jobs', { jobs: [], ownJobs: [{ ...job, status: 'closed' }] });
  assert.doesNotMatch(closedList, /href="\/jobs\/507f1f77bcf86cd799439012\/edit"/);
});

test('job forms preserve explicit Eastern-time input values and explain what is published', async () => {
  const html = await render('marketplace/newJob', {
    job, pets: [pet], action: `/jobs/${job._id}/edit`,
    values: {
      petId: pet._id, title: 'Edited title', description: 'Shared care expectations',
      location: 'Brooklyn', startDate: '2026-10-20T10:00', endDate: '2026-10-20T14:00', budget: 0,
    },
    errorMessage: 'Please check the end date.',
  });
  assert.match(html, /action="\/jobs\/507f1f77bcf86cd799439012\/edit" method="post"/);
  assert.match(html, /value="507f1f77bcf86cd799439011" selected/);
  assert.match(html, /<select id="petId"[^>]*disabled/);
  assert.match(html, /type="hidden" name="petId" value="507f1f77bcf86cd799439011"/);
  assert.match(html, /Post a new job to choose a different pet/);
  assert.match(html, /value="2026-10-20T10:00"/);
  assert.match(html, /value="2026-10-20T14:00"/);
  assert.match(html, /name="budget"[^>]*value="0"/);
  assert.match(html, /Eastern time/);
  assert.match(html, /private medical history is not shared automatically/);
  assert.match(html, /role="alert">Please check the end date/);
  assertPrivateDetailsHidden(html);
});

test('owners without pets get a pet creation action instead of an unusable job form', async () => {
  const html = await render('marketplace/newJob', { pets: [], values: {}, action: '/jobs' });
  assert.match(html, /href="\/pets\/add"/);
  assert.doesNotMatch(html, /action="\/jobs"/);
});

test('marketplace views escape user content and ignore non-upload image URLs', async () => {
  const payload = '<script>alert("unsafe")</script>';
  const html = await render('marketplace/sitter', {
    sitter: { ...sitter, firstName: payload, biography: payload, profilePhoto: 'https://untrusted.example/photo.png' },
  });
  assert.equal(html.includes(payload), false);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /untrusted.example/);
  const listing = await render('marketplace/job', { job: { ...job, title: payload, description: payload }, isOwner: true });
  assert.equal(listing.includes(payload), false);
});

test('both dashboards keep account tools and expose the new marketplace destinations', async () => {
  const own = await render('owner/dashboard', { user: { ...owner, pets: [pet] } });
  for (const url of ['/sitters', '/jobs', '/requests', '/messages', '/owner/profile', '/pets']) {
    assert.equal(own.includes(`href="${url}"`), true, url);
  }
  const sitterDashboard = await render('sitter/dashboard', { user: sitter });
  for (const url of ['/jobs', '/requests', '/messages', '/sitter/profile']) {
    assert.equal(sitterDashboard.includes(`href="${url}"`), true, url);
  }
  assert.ok(own.indexOf('marketplace-cta') < own.indexOf('stats-grid'));
  assert.ok(sitterDashboard.indexOf('marketplace-cta') < sitterDashboard.indexOf('stats-grid'));
});
