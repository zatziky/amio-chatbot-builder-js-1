const checkIsDefined = require('./utils/preconditions').checkIsDefined
const checkIsArray = require('./utils/preconditions').checkIsArray
const debug = require('logzio-node-debug').debug('moneta-chatbot:chatbot')
const error = require('logzio-node-debug').debug('moneta-chatbot:chatbot:error')
const chatbotCache = require('./chatbot-cache')
const path = require('ramda/src/path')


class Chatbot {

  // noinspection UnterminatedStatementJS
  constructor() {
    this.postbacks = []
    this.postbackKeyExtractor = postbackPayload => postbackPayload

    this.interceptors = []
    this.defaultPostbackState = null
    this.initialState = null
  }

  addInterceptor(interceptor) {
    checkIsDefined(interceptor.before, 'interceptor.before')
    checkIsDefined(interceptor.after, 'interceptor.after')
    this.interceptors.push(interceptor)
  }

  setInterceptors(interceptors){
    checkIsArray(interceptors, 'interceptors')
    interceptors.forEach((interceptor, i) => {
      checkIsDefined(interceptor.before, `interceptor[${i}].before`)
      checkIsDefined(interceptor.after, `interceptor[${i}].after`)
    })

    this.interceptors = interceptors
  }

  addPostback(key, state) {
    checkIsDefined(key, 'condition')
    checkIsDefined(state.execute, 'state.execute')

    this.postbacks[key] = state
  }

  setErrorPostbackState(state) {
    this.defaultPostbackState = state
  }

  setErrorNextState(state){
    // TODO how to implement it?
    // defaultStateHolder.set(state)
  }

  setInitialState(state) {
    this.initialState = state
  }

  setPostbackKeyExtractor(normalizerFunction) {
    this.postbackKeyExtractor = normalizerFunction
  }

  setNextState(contactId, nextState) {
    chatbotCache.setNextState(contactId, nextState)
  }

  // async runNextState(channelId, contactId, webhookData) {
  // noinspection UnterminatedStatementJS
  async runNextState(webhook) {
    const {channelId, contactId} = webhook
    if (!chatbotCache.getNextState(contactId)) {
      const nextState = await this._resolveNextStateFromLastState(contactId, webhook)
      // TODO nextState can be NULL; or again it can be a third default state; see state.findNextState
      chatbotCache.setNextState(contactId, nextState)
    }
    
    await this._runInterceptors(channelId, contactId, webhookData, async () => {
      try {
        while (chatbotCache.getNextState(contactId)) {
          const nextState = chatbotCache.getNextState(contactId)
          chatbotCache.setNextState(contactId, null)
          chatbotCache.pushPastState(contactId, nextState)
          debug('runNextState() - new state: ', nextState ? nextState.constructor.name : null)

          const newNextState = await nextState.execute(channelId, contactId, webhookData)
          chatbotCache.setNextState(contactId, newNextState)
        }
      } catch (err) {
        const lastState = chatbotCache.getLastState(contactId)
        error('lastState: ', lastState ? lastState.constructor.name : null, err)
      }
    })
  }

  async runPostback(channelId, contactId, webhookData) {
    const payload = path(['postback', 'payload'], webhookData)

    const postbackKey = this.postbackKeyExtractor(payload)
    const nextState = this.postbacks[postbackKey]

    if (nextState) chatbotCache.setNextState(contactId, nextState)
    else chatbotCache.setNextState(contactId, this.defaultPostbackState) // TODO this state should report error

    await this.runNextState(channelId, contactId, webhookData)
  }

  async _runInterceptors(channelId, contactId, webhookData, method) {
    try {
      let shallContinue
      for (const interceptor of this.interceptors) {
        shallContinue = await interceptor.before(channelId, contactId, webhookData)
        if (!shallContinue) break
      }

      await method()
    } finally {
      for (const interceptor of this.interceptors) {
        interceptor.after(channelId, contactId, webhookData)
      }
    }
  }

  async _resolveNextStateFromLastState(channelId, contactId, webhookData) {
    const lastState = chatbotCache.getLastState(contactId)
    if (lastState) {
      debug('_resolveNextStateFromLastState() - last state: ', lastState ? lastState.constructor.name : null)
      return await lastState.findNextState(channelId, contactId, webhookData, lastState)
    }

    if (this.initialState) return this.initialState

    throw new Error('initialState must be defined! It was ' + this.initialState)
  }
}

module.exports = Chatbot
