"use strict"
let path = require('path')
let fs = require('fs')
let express = require('express')
let morgan = require('morgan')
let nodeify = require('bluebird-nodeify')
let mime = require('mime-types')
let rimraf = require('rimraf')
let archiver = require('archiver')
let mkdirp = require('mkdirp')
let argv = require('yargs')
  .default('dir', process.cwd())
  .argv

let chokidar = require('chokidar')

let emitter = require('events').EventEmitter
let emitterObj = new emitter()

let wrap = require('co-express')

let net = require('net')
let jsonSocket = require('json-socket')
let server = net.createServer()

require('songbird')

const NODE_ENV = process.env.NODE_ENV
const PORT = process.env.PORT || 8000
const SERVER_PORT = 8001
const ROOT_DIR = path.resolve(argv.dir)

let app = express()

if (NODE_ENV === 'development') {
  app.use(morgan('dev'))
}

app.listen(PORT, ()=> console.log(`Listening @ http://127.0.0.1:${PORT}`))
console.log('Server LISTENING @ 127:0.0.1:8001')
server.listen(8001)
server.on('connection', (socket) => {
    console.log('Server connection')
    socket = new jsonSocket(socket)

    emitterObj.on('msgEvent', (data) => {
        console.log('Send message to client', data)
        socket.sendMessage(data)
    })

    socket.on('message', (message) => {
        console.log('Received message from client', message)
    })
})


function sendToClient(action, req) {
    let data = {
        "action": action,
        "path": req.url,
        "type": req.isDir ? "dir" : "file",
        "contents": action === "delete" ? null : new Buffer(req.read()).toString('base64'),
        "updated": Date.now()
    }
  emitterObj.emit('msgEvent', data)
}

app.get('*', setFileMeta, sendHeaders, (req, res) => {
  console.log("Executing GET\n")
  if (req.isDir || req.stat.isDirectory()) {

    if(req.headers && req.headers.accept === 'application/x-gtar') {
      console.log("archive the files")

      let archive = archiver('tar')
        archive.pipe(res);
        archive.bulk([
            { expand: true, cwd: ROOT_DIR, src: ['**'], dest: 'source'}
        ])
        archive.finalize()
    } else {
      if (res.body) {
        res.json(res.body)
        res.end()
      }
    }

  } else {
    if (res.body) {
      res.json(res.body)
    }

    fs.createReadStream(req.filePath).pipe(res)
  }
})

app.head('*', setFileMeta, sendHeaders, (req, res) => res.end())

app.delete('*', setFileMeta, wrap(function*(req, res, next) {
    if (!req.stat) return res.send(400, 'Invalid Path')

    if (req.stat.isDirectory()) {
      rimraf.promise(req.filePath)
    } else fs.promise.unlink(req.filePath)
    res.end()
    sendToClient("delete", req)
  }))

app.put('*', setFileMeta, setDirDetails, wrap(function*(req, res, next) {
    if (req.stat) return res.status(405).send('File exists')
      mkdirp.promise(req.dirPath)

    if (!req.isDir) req.pipe(fs.createWriteStream(req.filePath))
    res.end()
    sendToClient("put", req)
}))

app.post('*', setFileMeta, setDirDetails, wrap(function*(req, res, next) {
    if (!req.stat) return res.status(405).send('File does not exist')
    if (req.isDir || req.stat.isDirectory()) return res.status(405).send('Path is a directory')

    fs.promise.truncate(req.filePath, 0)
    req.pipe(fs.createWriteStream(req.filePath))
    res.end()
    sendToClient("post", req)
}))


function setDirDetails(req, res, next) {
  let filePath = req.filePath
  let endsWithSlash = filePath.charAt(filePath.length-1) === path.sep
  let hasExt = path.extname(filePath) !== ''
  req.isDir = endsWithSlash || !hasExt
  req.dirPath = req.isDir ? filePath : path.dirname(filePath)
  next()
}

function setFileMeta(req, res, next) {
  console.log("Executing setFileMeta\n")
  req.filePath = path.resolve(path.join(ROOT_DIR, req.url))
  console.log(req.filePath)
  if (req.filePath.indexOf(ROOT_DIR) !== 0) {
    res.send(400, 'Invalid path')
    return
  }
  fs.promise.stat(req.filePath)
    .then(stat => req.stat = stat, ()=> req.stat = null)
    .nodeify(next)
}

function sendHeaders(req, res, next) {
    console.log("Executing sendHeaders\n")
    if (req.stat.isDirectory()) {
      console.log("sendHeaders -- isDirectory\n")
      let files = fs.readdir(req.filePath, function(err, files) {
        res.body = JSON.stringify(files)
        console.log(res.body)
        res.setHeader('Content-Length', res.body.length)
        res.setHeader('Content-Type', 'application/json')
        next()
      })    
    } else {
      res.setHeader('Content-Length', req.stat.size)
      let contentType = mime.contentType(path.extname(req.filePath))
      res.setHeader('Content-Type', contentType)

      next()
    }   
}

chokidar.watch(argv.dir, {ignored: /[\/\\]\./}).on('all', (event, path) => {
      let tempPath = path
      path = path.substring(path.indexOf("/")+1, path.length)
      if (event === 'addDir' ) {
        console.log("Event " + event + " Path: " + path)
        emitterObj.emit('msgEvent', {'action':'write','path':path, 'type':'dir'})
      }
      if (event === 'unlinkDir' ) {
          console.log("Event " + event + " Path: " + path)
          emitterObj.emit('msgEvent', {'action':'delete','path':path, 'type':'dir'})
      }
      if (event === 'add') {
          console.log("Event " + event + " Path: " + path)
          let stream = fs.createReadStream(tempPath)
            streamToString(stream, (data) => {
              emitterObj.emit('msgEvent',
            {
              'action':'write',
              'path':path,
              'type':'file',
              'contents':new Buffer(data.toString('base64'))
            })
          })
      }
      if (event === 'unlink') {
          console.log("Event " + event + " Path: " + path)
          emitterObj.emit('msgEvent', {'action':'delete','path':path, 'type':'file'})
      }
  })



function streamToString(stream, cb) {
  const chunks = [];
  stream.on('data', (chunk) => {
    chunks.push(chunk);
  });
  stream.on('end', () => {
    cb(chunks.join(''));
  });
}