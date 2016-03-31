"use strict"
let fs = require('fs')
let path = require('path')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let argv = require('yargs')
        .default({dir: process.cwd()})
        .argv

let net = require('net')
let JsonSocket = require('json-socket')
require('songbird')

let socket = new JsonSocket(new net.Socket())
console.log("client connecting to port 127:0.0.1:8001")
socket.connect(8001, '127.0.0.1')

function handleMessage(message) {
    console.log(message)
    if (message.action === 'delete') {
        handleDelete(message)
    } else if (message.action === 'post') {
        handlePost(message)
    } else if (message.action === 'put' || message.action === 'write') {
        handlePut(message)
    } else {
        console.log('NOOP')
    }
}

socket.on('connect', () => {
    socket.on('message', (message) => {
        console.log('Received message from server: ', message)
        message.filePath = path.resolve(path.join(argv.dir, message.path))
        fs.stat(message.filePath, function(err, stats) {
            handleMessage(message)
        })
              
    })
})

function handleDelete(message) {
       console.log("DELETE", message)
        if (message.type === 'dir') {
            rimraf.promise(message.filePath)
        } else {
            fs.promise.unlink(message.filePath)
        }
}

function handlePut(message) {
        console.log("PUT", message)
        if (message.type === 'dir') {
              mkdirp(message.filePath)
            return
        }
        console.log("PUT", new Buffer(message.contents, 'base64').toString())  

        //fs.promise.truncate(message.filePath, 0)
        let fw = fs.createWriteStream(message.filePath)
        fw.write(new Buffer(message.contents, 'base64').toString())
        fw.end()
}

function handlePost(message) {
        console.log("POST", message)
        if (message.stat) {
            console.log(`${message.action}: File exists ${message.filePath}`)
        }
        let dirPath = message.type === 'dir' ? message.filePath : path.dirname(message.filePath)
        mkdirp.promise(dirPath)
        if (message.type === 'file') {
            let fw = fs.createWriteStream(message.filePath)
            fw.end(new Buffer(message.contents, 'base64').toString())
        }
}
