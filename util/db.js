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
          .filter(change => change.type === 'added')
          .forEach((change) => {
            const { doc } = change;
            callback(doc);
          });
      });
  });
}

module.exports = { db, watchTx };
