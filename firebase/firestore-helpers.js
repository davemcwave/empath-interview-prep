/**
 * Firestore Helpers
 *
 * Reusable CRUD wrappers for common Firestore operations.
 * Depends on firebase-config.js being loaded first.
 */
var Empath = window.Empath || {};

Empath.db = {
  /**
   * Get a single document by path.
   * @param {string} path - e.g. "users/abc123"
   * @returns {Promise<{id: string, ...data}|null>}
   */
  async getDoc(path) {
    const snap = await db.doc(path).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  },

  /**
   * Get all documents in a collection, optionally ordered.
   * @param {string} path - e.g. "users/abc123/sessions"
   * @param {string} [orderBy] - field to order by
   * @param {string} [direction] - "asc" or "desc"
   * @returns {Promise<Array<{id: string, ...data}>>}
   */
  async getCollection(path, orderBy, direction) {
    var ref = db.collection(path);
    if (orderBy) {
      ref = ref.orderBy(orderBy, direction || 'desc');
    }
    var snap = await ref.get();
    return snap.docs.map(function (doc) {
      return { id: doc.id, ...doc.data() };
    });
  },

  /**
   * Add a new document to a collection.
   * @param {string} path - collection path
   * @param {object} data
   * @returns {Promise<string>} the new document ID
   */
  async addDoc(path, data) {
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    var ref = await db.collection(path).add(data);
    return ref.id;
  },

  /**
   * Update an existing document.
   * @param {string} path - document path
   * @param {object} data - fields to merge
   */
  async updateDoc(path, data) {
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.doc(path).update(data);
  },

  /**
   * Set a document (create or overwrite).
   * @param {string} path - document path
   * @param {object} data
   * @param {boolean} [merge] - if true, merge with existing
   */
  async setDoc(path, data, merge) {
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.doc(path).set(data, { merge: !!merge });
  },

  /**
   * Delete a document.
   * @param {string} path - document path
   */
  async deleteDoc(path) {
    await db.doc(path).delete();
  },

  /**
   * Get all users with role "client", ordered by name.
   * @returns {Promise<Array>}
   */
  async getClients() {
    var snap = await db.collection('users')
      .where('role', '==', 'client')
      .get();
    var clients = snap.docs.map(function (doc) {
      return { id: doc.id, ...doc.data() };
    });
    clients.sort(function (a, b) {
      return (a.displayName || '').localeCompare(b.displayName || '');
    });
    return clients;
  },

  /** Firestore timestamp helper */
  timestamp: firebase.firestore.Timestamp,
  serverTimestamp: firebase.firestore.FieldValue.serverTimestamp
};

window.Empath = Empath;
