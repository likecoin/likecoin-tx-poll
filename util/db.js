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
db.settings({ timestampsInSnapshots: true });

function watchTx(callback) {
  const txRef = db.collection(config.FIRESTORE_TX_ROOT);
  WATCH_QUERIES.forEach((ANDedQueries) => {
    let ref = txRef;
    ANDedQueries.forEach((query) => {
      ref = ref.where(...query);
    });
    const queryStr = JSON.stringify(ANDedQueries);
    const watchRef = ref.orderBy('ts').limit(MAX_TX_IN_QUEUE);
    let unsubscribe;
    const watch = () => {
      unsubscribe = watchRef.onSnapshot((snapshot) => {
        snapshot.docChanges()
          .forEach((change) => {
            const { doc, type } = change;
            callback(doc, type);
          });
      }, (err) => {
        console.error(`Firestore error (query: ${queryStr}):`, err); // eslint-disable-line no-console
        unsubscribe();
        const timer = setInterval(() => {
          console.log(`Trying to restart watcher (query: ${queryStr})...`); // eslint-disable-line no-console
          try {
            watch();
            clearInterval(timer);
          } catch (innerErr) {
            console.log(`Watcher restart failed (query: ${queryStr}):`, innerErr); // eslint-disable-line no-console
          }
        }, 10000);
      });
      console.log(`Watcher for query ${queryStr} started.`); // eslint-disable-line no-console
    };
    watch();
  });
}

module.exports = { db, watchTx };
