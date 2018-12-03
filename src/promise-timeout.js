function promiseTimeout(ms, promise, comment) {
    let id;

    let timeout = new Promise((resolve, reject) => {
      id = setTimeout(() => {
        reject(`Promise timed out after ${ms}ms: ${comment}`)
      }, ms)
    })
  
    return Promise.race([
      promise,
      timeout
    ])
    .then((result) => {
      clearTimeout(id)
  
      /**
       * ... we also need to pass the result back
       */
      return result
    })
  }
  
module.exports = promiseTimeout;