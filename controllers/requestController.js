const CareRequest = require('../models/CareRequest');
const SittingJob = require('../models/SittingJob');
const Account = require('../models/accountSchema');
const Pet = require('../models/Pet');

const publicAccount = 'firstName lastName role profilePhoto rate';
const publicPet = 'name type photoUrl owner';
const requestPopulation = [
  { path: 'owner', select: publicAccount },
  { path: 'sitter', select: publicAccount },
  { path: 'pet', select: publicPet },
  { path: 'job', select: 'title location startDate endDate budget status' },
  { path: 'history.actor', select: 'firstName lastName role' },
];
const idOf = value => String(value && value._id || value || '');
const fail = (status, message) => Object.assign(new Error(message), { status });

function validId(value, label) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw fail(400, `Invalid ${label}.`);
  return value;
}

function currentUser(req, role) {
  if (!req.user) throw fail(401, 'Please sign in to manage requests.');
  if (!['owner', 'sitter'].includes(req.user.role) || role && req.user.role !== role) throw fail(403, 'Access denied.');
  return req.user;
}

function participants(user) {
  return { $or: [{ owner: user._id }, { sitter: user._id }] };
}

function inputValues(body = {}) {
  const values = {};
  for (const field of ['petId', 'proposedRate', 'message']) {
    values[field] = typeof body[field] === 'string' || typeof body[field] === 'number' ? String(body[field]) : '';
  }
  return values;
}

function offerInput(body = {}) {
  const raw = body.proposedRate;
  if (!['string', 'number'].includes(typeof raw) || !/^\d+(?:\.\d{1,2})?$/.test(String(raw).trim())) {
    throw fail(400, 'Enter an hourly rate with up to two decimal places.');
  }
  const proposedRate = Number(raw);
  if (!Number.isFinite(proposedRate) || proposedRate < 0 || proposedRate > 10000) throw fail(400, 'Hourly rates must be between $0 and $10,000.');
  if (body.message !== undefined && typeof body.message !== 'string') throw fail(400, 'Your message must be text.');
  const message = (body.message || '').trim();
  if (message.length > 2000) throw fail(400, 'Keep your message to 2,000 characters or fewer.');
  return { proposedRate, message };
}

function expectedVersion(body = {}) {
  const value = body.expectedVersion;
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) throw fail(400, 'Refresh the request before responding.');
  const version = Number(value);
  if (!Number.isSafeInteger(version)) throw fail(400, 'Refresh the request before responding.');
  return version;
}

async function interviewContext(req) {
  const user = currentUser(req, 'owner');
  const sitterId = validId(req.params.sitterId, 'sitter ID');
  const sitter = await Account.findOne({ _id: sitterId, role: 'sitter' }).select(publicAccount);
  if (!sitter) throw fail(404, 'Sitter not found.');
  const pets = await Pet.find({ owner: user._id }).select(publicPet);
  return { kind: 'interview', action: `/sitters/${sitterId}/requests`, sitter, pets };
}

async function jobContext(req) {
  currentUser(req, 'sitter');
  const jobId = validId(req.params.jobId, 'job ID');
  const job = await SittingJob.findOne({ _id: jobId, status: 'open', endDate: { $gt: new Date() } });
  if (!job) throw fail(404, 'This job is no longer available.');
  const owner = await Account.findOne({ _id: job.owner, role: 'owner' }).select(publicAccount);
  const pet = await Pet.findOne({ _id: job.pet, owner: job.owner }).select(publicPet);
  if (!owner || !pet) throw fail(404, 'This job is no longer available.');
  return { kind: 'job', action: `/jobs/${jobId}/requests`, job, owner, pet, pets: [] };
}

async function existingRequest(user, requestId) {
  const request = await CareRequest.findOne({ _id: validId(requestId, 'request ID'), ...participants(user) }).populate(requestPopulation);
  if (!request) throw fail(404, 'Request not found.');
  return request;
}

function detailLocals(user, careRequest, values = {}, errorMessage = '') {
  const otherParticipant = idOf(careRequest.owner) === idOf(user) ? careRequest.sitter : careRequest.owner;
  return { user, careRequest, otherParticipant, values, errorMessage };
}

function formStatus(error) {
  if (error.code === 11000) return 409;
  if (error.name === 'ValidationError') return 400;
  return [400, 409].includes(error.status) ? error.status : null;
}

async function creationError(req, res, next, error, context) {
  const status = formStatus(error);
  if (!context || !status) return next(error);
  const errorMessage = error.code === 11000
    ? 'You already have a pending request for this pet and sitter.'
    : error.name === 'ValidationError' ? 'Please check your request details.' : error.message;
  return res.status(status).render('requests/new', { user: req.user, context, values: inputValues(req.body), errorMessage });
}

async function getInterviewForm(req, res, next) {
  try {
    const context = await interviewContext(req);
    return res.render('requests/new', { user: req.user, context, values: { proposedRate: context.sitter.rate || 0 }, errorMessage: '' });
  } catch (error) { return next(error); }
}

async function createInterviewRequest(req, res, next) {
  let context;
  try {
    context = await interviewContext(req);
    const petId = validId(req.body?.petId, 'pet ID');
    const pet = await Pet.findOne({ _id: petId, owner: req.user._id }).select(publicPet);
    if (!pet) throw fail(400, 'Choose one of your pets.');
    if (!await Account.exists({ _id: req.user._id, role: 'owner' })) throw fail(404, 'Your account could not be found.');
    const { proposedRate, message } = offerInput(req.body);
    const request = await CareRequest.create({
      owner: req.user._id, sitter: context.sitter._id, pet: pet._id, kind: 'interview', job: null,
      initiatedBy: req.user._id, offerBy: req.user._id, proposedRate, message,
      history: [{ actor: req.user._id, action: 'created', rate: proposedRate, message }],
    });
    return res.redirect(`/requests/${request._id}`);
  } catch (error) { return creationError(req, res, next, error, context); }
}

async function getJobRequestForm(req, res, next) {
  try {
    const context = await jobContext(req);
    return res.render('requests/new', { user: req.user, context, values: { proposedRate: context.job.budget || 0 }, errorMessage: '' });
  } catch (error) { return next(error); }
}

async function createJobRequest(req, res, next) {
  let context;
  try {
    context = await jobContext(req);
    if (!await Account.exists({ _id: req.user._id, role: 'sitter' })) throw fail(404, 'Your account could not be found.');
    const { proposedRate, message } = offerInput(req.body);
    if (!await SittingJob.exists({ _id: context.job._id, owner: context.owner._id, pet: context.pet._id, status: 'open', endDate: { $gt: new Date() } })) {
      throw fail(409, 'This job is no longer available.');
    }
    const request = await CareRequest.create({
      owner: context.owner._id, sitter: req.user._id, pet: context.pet._id, job: context.job._id, kind: 'job',
      initiatedBy: req.user._id, offerBy: req.user._id, proposedRate, message,
      history: [{ actor: req.user._id, action: 'created', rate: proposedRate, message }],
    });
    return res.redirect(`/requests/${request._id}`);
  } catch (error) { return creationError(req, res, next, error, context); }
}

async function listRequests(req, res, next) {
  try {
    const user = currentUser(req);
    const careRequests = await CareRequest.find(participants(user)).populate(requestPopulation).sort({ updatedAt: -1 });
    return res.render('requests/index', { user, careRequests });
  } catch (error) { return next(error); }
}

async function getRequest(req, res, next) {
  try {
    const user = currentUser(req);
    const request = await existingRequest(user, req.params.requestId);
    return res.render('requests/detail', detailLocals(user, request));
  } catch (error) { return next(error); }
}

async function mutationError(req, res, next, error, request) {
  const status = formStatus(error);
  if (!request || !status) return next(error);
  try {
    const current = status === 409 ? await existingRequest(req.user, req.params.requestId) : request;
    const errorMessage = error.code === 11000 ? 'Another sitter has already been accepted for this job.' : error.message;
    return res.status(status).render('requests/detail', detailLocals(req.user, current, inputValues(req.body), errorMessage));
  } catch (renderError) { return next(renderError); }
}

async function proposeOffer(req, res, next) {
  let request;
  try {
    const user = currentUser(req);
    request = await existingRequest(user, req.params.requestId);
    if (request.status !== 'pending') throw fail(409, 'This request is no longer pending.');
    const version = expectedVersion(req.body);
    if (version !== request.__v) throw fail(409, 'This request changed. Review the latest offer before trying again.');
    if (request.kind === 'job' && !await SittingJob.exists({ _id: idOf(request.job), owner: idOf(request.owner), status: 'open', endDate: { $gt: new Date() } })) {
      throw fail(409, 'This job is closed or has ended. You can still decline or withdraw the request, or continue in messages.');
    }
    const { proposedRate, message } = offerInput(req.body);
    const updated = await CareRequest.findOneAndUpdate({
      _id: request._id, ...participants(user), status: 'pending', __v: version,
    }, {
      $set: { proposedRate, offerBy: user._id },
      $push: { history: { actor: user._id, action: 'offer', rate: proposedRate, message, at: new Date() } },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) throw fail(409, 'This request changed. Review the latest offer before trying again.');
    return res.redirect(`/requests/${request._id}`);
  } catch (error) { return mutationError(req, res, next, error, request); }
}

async function rollbackAcceptance(requestId, version, user) {
  const restored = await CareRequest.findOneAndUpdate({ _id: requestId, ...participants(user), status: 'accepted', __v: version + 1 }, {
    $set: { status: 'pending' }, $pop: { history: 1 }, $inc: { __v: 1 },
  }, { new: true });
  if (!restored) throw fail(500, 'The request could not be restored after the job changed.');
}

async function respondToRequest(req, res, next) {
  let request;
  try {
    const user = currentUser(req);
    request = await existingRequest(user, req.params.requestId);
    if (request.status !== 'pending') throw fail(409, 'This request is no longer pending.');
    const action = req.body?.action;
    if (!['accept', 'decline', 'withdraw'].includes(action)) throw fail(400, 'Choose accept, decline, or withdraw.');
    if (action === 'withdraw' && idOf(request.initiatedBy) !== idOf(user)) throw fail(403, 'Only the person who sent this request can withdraw it.');
    if (action !== 'withdraw' && idOf(request.offerBy) === idOf(user)) throw fail(403, 'The other participant must respond to your offer.');
    const version = expectedVersion(req.body);
    if (version !== request.__v) throw fail(409, 'This request changed. Review the latest offer before responding.');
    if (req.body.message !== undefined && typeof req.body.message !== 'string') throw fail(400, 'Your message must be text.');
    const message = (req.body.message || '').trim();
    if (message.length > 2000) throw fail(400, 'Keep your message to 2,000 characters or fewer.');
    if (action === 'accept') {
      const [ownerExists, sitterExists, petExists] = await Promise.all([
        Account.exists({ _id: idOf(request.owner), role: 'owner' }),
        Account.exists({ _id: idOf(request.sitter), role: 'sitter' }),
        Pet.exists({ _id: idOf(request.pet), owner: idOf(request.owner) }),
      ]);
      if (!ownerExists || !sitterExists || !petExists) throw fail(409, 'A participant or pet is no longer available.');
      if (request.kind === 'job' && !await SittingJob.exists({ _id: idOf(request.job), owner: idOf(request.owner), status: 'open', endDate: { $gt: new Date() } })) {
        throw fail(409, 'This job is no longer open.');
      }
    }
    const status = { accept: 'accepted', decline: 'declined', withdraw: 'withdrawn' }[action];
    const filter = { _id: request._id, ...participants(user), status: 'pending', __v: version };
    if (action === 'withdraw') filter.initiatedBy = user._id;
    else filter.offerBy = { $ne: user._id };
    const updated = await CareRequest.findOneAndUpdate(filter, {
      $set: { status },
      $push: { history: { actor: user._id, action: status, rate: request.proposedRate, message, at: new Date() } },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) throw fail(409, 'This request changed. Review the latest offer before responding.');
    if (action === 'accept' && request.kind === 'job') {
      try {
        const result = await SittingJob.updateOne({ _id: idOf(request.job), owner: idOf(request.owner), status: 'open', endDate: { $gt: new Date() } }, { $set: { status: 'closed' } });
        if (!result.matchedCount) throw fail(409, 'This job is no longer open.');
      } catch (closeError) {
        try {
          await rollbackAcceptance(request._id, version, user);
        } catch (rollbackError) {
          console.error('Unable to restore request after job closing failed:', rollbackError);
          throw rollbackError;
        }
        throw closeError;
      }
    }
    return res.redirect(`/requests/${request._id}`);
  } catch (error) { return mutationError(req, res, next, error, request); }
}

module.exports = { getInterviewForm, createInterviewRequest, getJobRequestForm, createJobRequest, listRequests, getRequest, proposeOffer, respondToRequest };
