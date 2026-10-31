const mongoose = require('mongoose');
const Account = require('../models/accountSchema');
const Pet = require('../models/Pet');
const SittingJob = require('../models/SittingJob');
const { inputError } = require('../utils/profile');
const { dateInput, parseDateInput } = require('../utils/dates');

const publicSitter = '_id firstName lastName biography experience rate profilePhoto';
const publicOwner = '_id firstName lastName profilePhoto role';
const publicPet = '_id name type photoUrl owner';
const pageSize = 12;

function requireOwner(req) {
  if (req.user.role !== 'owner') throw inputError('Only pet owners can manage sitting jobs.', 403);
}

function validId(value, label = 'ID') {
  if (!mongoose.isObjectIdOrHexString(value)) throw inputError(`Invalid ${label}.`);
  return value;
}

function pageNumber(query = {}) {
  if (query.page === undefined || query.page === '') return 1;
  if (typeof query.page !== 'string' || !/^[1-9]\d{0,5}$/.test(query.page)) throw inputError('Choose a valid page.');
  return Number(query.page);
}

function pagination(path, query, page, total) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = number => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === 'string' && value && key !== 'page') params.set(key, value);
    params.set('page', String(number));
    return `${path}?${params}`;
  };
  return { page, pages, total, previous: page > 1 ? link(page - 1) : null, next: page < pages ? link(page + 1) : null };
}

function populateJobs(query) {
  return query.populate('owner', publicOwner).populate('pet', publicPet);
}

function jobValues(body = {}) {
  return Object.fromEntries(['petId', 'title', 'description', 'location', 'startDate', 'endDate', 'budget']
    .map(field => [field, typeof body[field] === 'string' ? body[field] : typeof body[field] === 'number' && field === 'budget' ? String(body[field]) : '']));
}

function jobInput(body = {}) {
  const values = jobValues(body);
  for (const field of ['title', 'description', 'location']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') throw inputError('Job details must be text.');
    values[field] = values[field].trim();
  }
  validId(body.petId, 'pet');
  if (!values.title || !values.description) throw inputError('Add a title and care details for your sitting job.');
  if (values.title.length > 120 || values.description.length > 3000 || values.location.length > 120) {
    throw inputError('Keep titles and locations under 120 characters and care details under 3,000 characters.');
  }
  const startDate = parseDateInput(values.startDate, 'Start time');
  const endDate = parseDateInput(values.endDate, 'End time');
  if (startDate <= new Date()) throw inputError('Choose a start time in the future.');
  if (endDate <= startDate) throw inputError('End time must be after start time.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(values.budget) || !Number.isFinite(Number(values.budget)) || Number(values.budget) > 10000) {
    throw inputError('Enter an hourly budget from $0 to $10,000 with up to two decimal places.');
  }
  return { pet: body.petId, title: values.title, description: values.description, location: values.location, startDate, endDate, budget: Number(values.budget) };
}

async function ownerPets(user) {
  return Pet.find({ owner: user._id }).select('_id name type').sort({ name: 1 });
}

async function getJobs(req, res, next) {
  try {
    const page = pageNumber(req.query);
    const isOwner = req.user.role === 'owner';
    const filter = isOwner ? { owner: req.user._id } : { status: 'open', endDate: { $gt: new Date() } };
    if (!isOwner && req.query.owner) filter.owner = validId(req.query.owner, 'owner');
    const total = await SittingJob.countDocuments(filter);
    const jobs = await populateJobs(SittingJob.find(filter).sort(isOwner ? { createdAt: -1, _id: -1 } : { startDate: 1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize)).lean();
    const visible = jobs.filter(job => job.owner?.role === 'owner' && job.pet && String(job.pet.owner) === String(job.owner._id));
    return res.render('marketplace/jobs', { user: req.user, jobs: visible, ownJobs: isOwner ? visible : [], pagination: pagination('/jobs', req.query, page, total) });
  } catch (error) { return next(error); }
}

async function getJob(req, res, next) {
  try {
    const id = validId(req.params.jobId, 'job');
    const filter = { _id: id, ...(req.user.role === 'owner' ? { owner: req.user._id } : {}) };
    const job = await populateJobs(SittingJob.findOne(filter)).lean();
    if (!job || !job.owner || !job.pet || String(job.pet.owner) !== String(job.owner._id)) throw inputError('Sitting job not found.', 404);
    return res.render('marketplace/job', { user: req.user, job, isOwner: String(job.owner._id) === String(req.user._id) });
  } catch (error) { return next(error); }
}

async function getNewJob(req, res, next) {
  try {
    requireOwner(req);
    return res.render('marketplace/newJob', { user: req.user, pets: await ownerPets(req.user), values: {}, errorMessage: null, job: null, action: '/jobs' });
  } catch (error) { return next(error); }
}

async function getEditJob(req, res, next) {
  try {
    requireOwner(req);
    const job = await SittingJob.findOne({ _id: validId(req.params.jobId, 'job'), owner: req.user._id });
    if (!job) throw inputError('Sitting job not found.', 404);
    if (job.status !== 'open') throw inputError('Closed jobs cannot be edited.', 409);
    return res.render('marketplace/newJob', {
      user: req.user, pets: await ownerPets(req.user), job, errorMessage: null, action: `/jobs/${job._id}/edit`,
      values: { petId: String(job.pet), title: job.title, description: job.description, location: job.location, startDate: dateInput(job.startDate), endDate: dateInput(job.endDate), budget: String(job.budget) },
    });
  } catch (error) { return next(error); }
}

async function jobFormError(req, res, next, error, job = null) {
  if (error.status !== 400 && error.name !== 'ValidationError') return next(error);
  const pets = await ownerPets(req.user);
  return res.status(400).render('marketplace/newJob', {
    user: req.user, pets, values: jobValues(req.body), errorMessage: error.name === 'ValidationError' ? 'Please check the job details.' : error.message,
    job, action: job ? `/jobs/${job._id}/edit` : '/jobs',
  });
}

async function createJob(req, res, next) {
  try {
    requireOwner(req);
    const data = jobInput(req.body);
    const pet = await Pet.findOne({ _id: data.pet, owner: req.user._id });
    if (!pet) throw inputError('Choose one of your own pets.');
    const job = await SittingJob.create({ ...data, owner: req.user._id });
    return res.redirect(`/jobs/${job._id}`);
  } catch (error) {
    try { return await jobFormError(req, res, next, error); } catch (failure) { return next(failure); }
  }
}

async function updateJob(req, res, next) {
  let job;
  try {
    requireOwner(req);
    const filter = { _id: validId(req.params.jobId, 'job'), owner: req.user._id };
    job = await SittingJob.findOne(filter);
    if (!job) throw inputError('Sitting job not found.', 404);
    if (job.status !== 'open') throw inputError('Closed jobs cannot be edited.', 409);
    const data = jobInput(req.body);
    if (String(data.pet) !== String(job.pet)) throw inputError('Keep the same pet for an existing job. Post a new job for a different pet.');
    if (!await Pet.exists({ _id: data.pet, owner: req.user._id })) throw inputError('Pet not found.', 404);
    // Keep the original pet and only change an open listing, so existing requests retain their context.
    const updated = await SittingJob.findOneAndUpdate({ ...filter, status: 'open' }, { $set: data }, { new: true, runValidators: true });
    if (!updated) throw inputError('This job was closed. Refresh to see its current status.', 409);
    return res.redirect(`/jobs/${job._id}`);
  } catch (error) {
    try { return await jobFormError(req, res, next, error, job); } catch (failure) { return next(failure); }
  }
}

async function closeJob(req, res, next) {
  try {
    requireOwner(req);
    const job = await SittingJob.findOneAndUpdate({ _id: validId(req.params.jobId, 'job'), owner: req.user._id }, { $set: { status: 'closed' } }, { new: true });
    if (!job) throw inputError('Sitting job not found.', 404);
    return res.redirect(`/jobs/${job._id}`);
  } catch (error) { return next(error); }
}

async function getSitters(req, res, next) {
  try {
    requireOwner(req);
    const page = pageNumber(req.query);
    const q = req.query.q === undefined ? '' : req.query.q;
    const maxRate = req.query.maxRate === undefined ? '' : req.query.maxRate;
    if (typeof q !== 'string' || q.length > 80 || typeof maxRate !== 'string') throw inputError('Please check your search filters.');
    const filter = { role: 'sitter' };
    const trimmed = q.trim();
    if (trimmed) {
      const search = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = ['firstName', 'lastName', 'biography', 'experience'].map(field => ({ [field]: search }));
    }
    if (maxRate !== '') {
      if (!/^\d+(?:\.\d{1,2})?$/.test(maxRate) || Number(maxRate) > 10000) throw inputError('Choose a maximum hourly rate from $0 to $10,000.');
      filter.rate = { $lte: Number(maxRate) };
    }
    const total = await Account.countDocuments(filter);
    const sitters = await Account.find(filter).select(publicSitter).sort({ rate: 1, firstName: 1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean();
    return res.render('marketplace/sitters', { user: req.user, sitters, filters: { q, maxRate }, errorMessage: null, pagination: pagination('/sitters', req.query, page, total) });
  } catch (error) { return next(error); }
}

async function getSitter(req, res, next) {
  try {
    requireOwner(req);
    const sitter = await Account.findOne({ _id: validId(req.params.sitterId, 'sitter'), role: 'sitter' }).select(publicSitter).lean();
    if (!sitter) throw inputError('Sitter not found.', 404);
    return res.render('marketplace/sitter', { user: req.user, sitter });
  } catch (error) { return next(error); }
}

module.exports = { getJobs, getJob, getNewJob, getEditJob, createJob, updateJob, closeJob, getSitters, getSitter };
