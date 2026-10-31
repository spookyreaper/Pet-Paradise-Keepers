const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const test = require('node:test');
const { uploadedPhoto, discardUploads, removeStoredPhoto, removeAccountUploads } = require('../utils/upload');

test('upload cleanup stays within the intended files and account directory', async t => {
  const root = path.resolve(__dirname, '../public/uploads');
  const userId = randomBytes(12).toString('hex');
  const otherId = randomBytes(12).toString('hex');
  const directory = path.join(root, 'owners', userId);
  const otherDirectory = path.join(root, 'owners', otherId);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-photo-test-'));
  const protectedFile = path.join(outside, 'keep.png');
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(otherDirectory, { recursive: true });
  await fs.writeFile(protectedFile, 'keep');
  try {
    await t.test('photo URLs support absolute disk paths and reject files outside uploads', () => {
      assert.equal(uploadedPhoto({ path: path.join(directory, 'photo.png') }), `/uploads/owners/${userId}/photo.png`);
      assert.equal(uploadedPhoto(), '');
      assert.throws(() => uploadedPhoto({ path: protectedFile }), /Invalid upload path/);
    });

    await t.test('discard handles both single and paired uploads while retaining saved photos', async () => {
      const saved = path.join(directory, 'saved.png');
      const single = path.join(directory, 'single.png');
      const paired = path.join(directory, 'paired.png');
      await Promise.all([saved, single, paired].map(file => fs.writeFile(file, 'photo')));
      await discardUploads({ file: { path: single }, files: { petPhoto: [{ path: paired }], ownerPhoto: [{ path: protectedFile }] } });
      assert.equal(await fs.readFile(saved, 'utf8'), 'photo');
      await assert.rejects(fs.stat(single), { code: 'ENOENT' });
      await assert.rejects(fs.stat(paired), { code: 'ENOENT' });
      assert.equal(await fs.readFile(protectedFile, 'utf8'), 'keep');
    });

    await t.test('removal supports legacy relative URLs and ignores traversal or external URLs', async () => {
      const old = path.join(directory, 'old.png');
      await fs.writeFile(old, 'photo');
      await removeStoredPhoto(`uploads/owners/${userId}/old.png`);
      await assert.rejects(fs.stat(old), { code: 'ENOENT' });
      for (const prefix of ['public/uploads', '/public/uploads']) {
        await fs.writeFile(old, 'photo');
        await removeStoredPhoto(`${prefix}/owners/${userId}/old.png`);
        await assert.rejects(fs.stat(old), { code: 'ENOENT' });
      }
      await removeStoredPhoto(`/uploads/${path.relative(root, protectedFile)}`);
      await removeStoredPhoto('https://example.com/photo.png');
      assert.equal(await fs.readFile(protectedFile, 'utf8'), 'keep');
    });

    await t.test('account cleanup refuses invalid roles and IDs, then removes only its directory', async () => {
      await removeAccountUploads({ _id: userId, role: 'admin' });
      await removeAccountUploads({ _id: '../', role: 'owner' });
      assert.ok(await fs.stat(directory));
      await removeAccountUploads({ _id: userId, role: 'owner' });
      await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
      assert.ok(await fs.stat(otherDirectory));
    });
  } finally {
    await Promise.all([directory, otherDirectory, outside].map(dir => fs.rm(dir, { recursive: true, force: true })));
  }
});
