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

  /**
   * Get comments for an item.
   * @param {string} itemPath - e.g. "users/abc/sessions/xyz"
   * @returns {Promise<Array>}
   */
  async getComments(itemPath) {
    var snap = await db.collection(itemPath + '/comments').orderBy('createdAt', 'asc').get();
    return snap.docs.map(function (doc) {
      return { id: doc.id, ...doc.data() };
    });
  },

  /**
   * Add a comment to an item.
   * @param {string} itemPath - e.g. "users/abc/sessions/xyz"
   * @param {string} text
   * @param {string} author - "client" or "admin"
   * @param {string} authorName
   */
  async addComment(itemPath, text, author, authorName) {
    await db.collection(itemPath + '/comments').add({
      text: text,
      author: author,
      authorName: authorName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /** Firestore timestamp helper */
  timestamp: firebase.firestore.Timestamp,
  serverTimestamp: firebase.firestore.FieldValue.serverTimestamp
};

/**
 * Render a comment thread into a container element.
 * @param {HTMLElement} container
 * @param {string} itemPath - Firestore path to the item
 * @param {string} role - "client" or "admin"
 * @param {string} authorName
 */
Empath.renderCommentThread = function (container, itemPath, role, authorName) {
  container.innerHTML = '<div class="comment-thread"><div class="comment-list"></div>' +
    '<form class="comment-form">' +
    '<input type="text" class="form-input" placeholder="Add a comment..." required />' +
    '<button type="submit" class="btn btn--accent btn--sm">Send</button>' +
    '</form></div>';

  var listEl = container.querySelector('.comment-list');
  var form = container.querySelector('.comment-form');
  var input = form.querySelector('.form-input');

  function loadComments() {
    Empath.db.getComments(itemPath).then(function (comments) {
      if (comments.length === 0) {
        listEl.innerHTML = '<p class="comment-empty">No comments yet.</p>';
        return;
      }
      listEl.innerHTML = comments.map(function (c) {
        var time = c.createdAt && c.createdAt.toDate
          ? c.createdAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : '';
        return '<div class="comment comment--' + _esc(c.author) + '">' +
          '<div class="comment__meta">' + _esc(c.authorName) + ' &middot; ' + time + '</div>' +
          '<div class="comment__text">' + _esc(c.text) + '</div>' +
          '</div>';
      }).join('');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    Empath.db.addComment(itemPath, text, role, authorName).then(loadComments);
  });

  loadComments();
};

function _esc(str) {
  var el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

window.Empath = Empath;
