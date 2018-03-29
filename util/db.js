const admin = require('firebase-admin');
const serviceAccount = require('../config/serviceAccountKey.json');
const config = require('../config/config.js');

const WATCH_QUERIES = config.WATCH_QUERIES || [
  [['status', '==', 'pending']],
];
const MAX_TX_IN_QUEUE = config.MAX_TX_IN_QUEUE || 1000;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

function watchTx(callback) {
  const txRef = db.collection(config.FIRESTORE_TX_ROOT);
  WATCH_QUERIES.forEach((ANDedQueries) => {
    let ref = txRef;
    ANDedQueries.forEach((query) => {
      ref = ref.where(...query);
    });
    ref.orderBy('ts')
      .limit(MAX_TX_IN_QUEUE)
      .onSnapshot((snapshot) => {
        snapshot.docChanges
          .forEach((change) => {
            const { doc, type } = change;
            callback(doc, type);
          });
      }, (err) => {
        console.error('Firestore error', err); // eslint-disable-line no-console
        console.error('Terminating...'); // eslint-disable-line no-console
        process.exit(1);
      });
  });
}

module.exports = { db, watchTx };
