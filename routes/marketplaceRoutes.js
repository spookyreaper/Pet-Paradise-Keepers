const router = require('express').Router();
const marketplace = require('../controllers/marketplaceController');
const requests = require('../controllers/requestController');
const messages = require('../controllers/messageController');
const authenticated = require('../middlewares/ensureAuthenticated');
const owner = require('../middlewares/ensureAuthenticatedOwner');
const sitter = require('../middlewares/ensureAuthenticatedSitter');

router.get('/jobs', authenticated, marketplace.getJobs);
router.get('/jobs/new', owner, marketplace.getNewJob);
router.post('/jobs', owner, marketplace.createJob);
router.get('/jobs/:jobId/edit', owner, marketplace.getEditJob);
router.post('/jobs/:jobId/edit', owner, marketplace.updateJob);
router.post('/jobs/:jobId/close', owner, marketplace.closeJob);
router.get('/jobs/:jobId/request', sitter, requests.getJobRequestForm);
router.post('/jobs/:jobId/requests', sitter, requests.createJobRequest);
router.get('/jobs/:jobId', authenticated, marketplace.getJob);

router.get('/sitters', owner, marketplace.getSitters);
router.get('/sitters/:sitterId/request', owner, requests.getInterviewForm);
router.post('/sitters/:sitterId/requests', owner, requests.createInterviewRequest);
router.get('/sitters/:sitterId', owner, marketplace.getSitter);

router.get('/requests', authenticated, requests.listRequests);
router.get('/requests/:requestId', authenticated, requests.getRequest);
router.post('/requests/:requestId/offers', authenticated, requests.proposeOffer);
router.post('/requests/:requestId/respond', authenticated, requests.respondToRequest);

router.get('/messages', authenticated, messages.listConversations);
router.get('/messages/new', authenticated, messages.getNewConversation);
router.post('/messages/start', authenticated, messages.startConversation);
router.get('/messages/:conversationId/updates', authenticated, messages.getConversationUpdates);
router.get('/messages/:conversationId', authenticated, messages.getConversation);
router.post('/messages/:conversationId', authenticated, messages.sendMessage);

module.exports = router;
