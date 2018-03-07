const retry = require('./retry.js');
const poll = require('./poll.js');
const config = require('./config/config.js');

switch (config.QUEUE_MODE) {
  case 'RETRY':
    retry.start();
    break;
  case 'POLL':
    poll.start();
    break;
  default:
    throw new Error(`Invalid QUEUE_MODE '${config.QUEUE_MODE}' (expect 'RETRY' or 'POLL')`);
}

// vim: set ts=2 sw=2:
