# amio-chatbot-builder-js

[![npm version](https://badge.fury.io/js/amio-chatbot-builder.svg)](https://badge.fury.io/js/amio-chatbot-builder)

**!!WARNING!!** 

This project is in **Alpha**. We will very likely make breaking changes in this project.

## Installation

```bash
npm install amio-chatbot-builder --save
```

You will want to send and receive messages. For this purpose install [amio-sdk-js](https://github.com/amio-io/amio-sdk-js).
```bash
npm install amio-sdk-js --save
```

## Usage

### Prerequisities

1. Setup NodeJs - we prefer to use it with Express (use [generator](https://expressjs.com/en/starter/generator.html))
2. [Setup Amio webhooks](https://github.com/amio-io/amio-sdk-js#webhooks---setup--usage) 

### Basic setup
You can copy/paste this setup.

#### 1. Create state
```javascript
// file echo.state.js
const State = require('amio-chatbot-builder').State
const AmioApi = require('amio-sdk-js').AmioApi

const amioApi = new AmioApi({
    accessToken: 'get access token from https://app.amio.io/administration/settings/api'
})

class EchoState extends State {
  
  constructor(){
    super()
    this.addNextState(this, webhook => true)
  }
  
  async execute(channelId, contactId, webhook) {
    const {data} = webhook
    const payload = data.content ? data.content.payload : data.postback.payload
    await this._sendMessage(channelId, contactId, payload)
  }
  
  async _sendMessage(channelId, contactId, text){
    await amioApi.messages.send({
      contact: {id: contactId},
      channel: {id: channelId},
      content: {
        type: 'structure',
        payload: {
          text,
          buttons: [{
            type: 'postback',
            title: 'Click me',
            payload: 'POSTBACK_CLICKED' 
          }]
        }
      }
    })
  }
}

module.exports = EchoState
```


#### 2. Setup chatbot
```javascript
// file my-chatbot.js
const Chatbot = require('amio-chatbot-builder').Chatbot
const EchoState = require('./path/to/echo.state.js')

class MyChatbot extends Chatbot {
  constructor(){
    super()
    const echoState = new EchoState()
    this.addPostback('POSTBACK_CLICKED', echoState)
    this.setInitialState(echoState)
  }
}

module.exports = new MyChatbot() // make it singleton (not obligatory ;)
```


#### 3. React to webhooks

After [setting up Amio webhooks](https://github.com/amio-io/amio-sdk-js#webhooks---setup--usage) you can pass the webhook events to your chatbot.

```javascript
// file router.js
const express = require('express')
const router = express.Router()
const chatbot = require('./path/to/my-chatbot.js')
const WebhookRouter = require('amio-sdk-js').WebhookRouter

const amioWebhookRouter = new WebhookRouter({
    secretToken: 'get secret at https://app.amio.io/administration/channels/{{CHANNEL_ID}}/webhook'
})

amioWebhookRouter.onMessageReceived(async webhook => await chatbot.runNextState(webhook))
amioWebhookRouter.onPostbackReceived(async webhook => await chatbot.runPostback(webhook))
// you can react to other webhook events too

router.post('/webhooks/amio', (req, res) => amioWebhookRouter.handleEvent(req, res))

module.exports = router
```

### Chatbot

Chatbot represents a state machine. The most important methods you'll be using are `chatbot.runNextState()` and `chatbot.runPostback()`.

You can set it up using either inheritance or composition:
```javascript
//Inheritance
class MyChatbot extends Chatbot {
  constructor(){
    super()
    this.addPostback()
    // ...
  }
}

// Composition
const chatbot = new Chatbot()
chatbot.addPostback()
// ...
```  

Method  | Params | Description
------- | ------ | -----------  
addInterceptor  | interceptor | Registers a new interceptor at the end of the interceptor chain. 
addPostback  | key<br/>state | Registers a state that will be invoked after postback with a specific `key` is received 
runNextState | [webhook](https://docs.amio.io/v1.0/reference#section-webhook-content) | How it works:<br/>&emsp;1. Iterate all interceptors\` `before()`.<br/>&emsp;2. Keep executing states while `state.execute()` returns a state.<br/>&emsp;3. Iterate all interceptors\` `after()`.<br/><br />**Warning -** If an interceptor returns false, go directly to step 3.   
runPostback | [webhook](https://docs.amio.io/v1.0/reference#section-webhook-content) | Picks a correct state that was registered using `chatbot.addPostback()`. Then it executes `chatbot.runNextState()`    
setErrorPostbackState | state | State that is executed if no postback is matching the key registered in `chatbot.addPostback(key, state)`.
setInitialState | state | If no postback starts the chatbot, the initial state will be executed as the very first state.  
setInterceptors | array(interceptor) interceptors | Sets the whole interceptor chain. The first interceptor is to be run first.
setPostbackKeyExtractor | function | Normalizes postback key so that it can be used to find a correct. It's useful if you're passing some data in postback like `'POSTBACK:ARBITRARY_DATA'`. In this case, you would register a state as `chatbot.addpostback('POSTBACK', state)`<br/><br/>It accepts webhook.data.postback.payload as the function argument. 

### State transitions - static vs. dynamic 

**Static transitions** between states are known from the app startup (or from the compilation). They are defined as `chatbot.addPostback(key, state)` or as `state.addNextState(state, condition)`.
```javascript
function condition(webhook){
  if(now() % 2 === 0) return true // use this state after next webhook event is received
  
  return false
}
```

**Dynamic transitions** between states are decided either in `state.execute()` or anywhere you call `chatbotCache.setNextState()`. 
You can run a state immediately without having to wait for another webhook if you return it from `state.execute()`. 

```javascript
class MyState extends State {
  
  execute(channelId, contactId, {data}){
    if(data.content) { 
      console.log('I will execute YourState right now!')
      return new YourState() 
    } 
    
    console.log('just log') 
  }
}
``` 

### Interceptors

Interceptors are used to influence received webhook events either before or after a state is executed. 
An interceptor is a class that extends `require('amio-chatbot-builder').Interceptor`.
Register interceptors using `chatbot.setInterceptors([interceptor1, ...])`

How the interceptors:
&emsp;1. Your server receives a webhook event.
&emsp;2. You pass the event over to chatbot via `chatbot.runNextState(webhook)`
&emsp;3. Chatbot first iterate all interceptors\` `before()`. The first interceptor that returns `false` breaks the interceptor chain and state execution is skipped. Go directly to step 5.
&emsp;4. Chatbot keeps executing states while `state.execute()` returns a new state.
&emsp;5. Chatbot iterates all interceptors\` `after()`.  

[SEE EXAMPLE](docs/interceptors.md) .

Method  | Params | Description
------- | ------ | -----------  
before | channelId<br/>contactId<br/>[webhook](https://docs.amio.io/v1.0/reference#section-webhook-content)| `before()` is executed before the state itself. Return `false` if you wish to prevent the state execution. No other interceptors will be run either.<br/>You can also change state using `chatbotCache.setNextState(newState)`.
after | channelId<br/>contactId<br/>[webhook](https://docs.amio.io/v1.0/reference#section-webhook-content)| `after()` is executed after the state execution. It good for a clean up. All registered interceptors are always executed. 


TODO state
TODO postback
TODO chatbotCache
TODO state machine picture with echo.state and postback
