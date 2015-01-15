Mapbaker = function() {
    // each file will be num x num
    this.numHexes = 11

    this.hexSize = s.hex_size
    this.hexSquish = s.hex_squish

    this.s3 = Knox.createClient({
        key: Meteor.settings.s3key,
        secret: Meteor.settings.s3secretKey,
        bucket: Meteor.settings.s3bucket,
        region: Meteor.settings.s3region
    })

    this.fs = Npm.require('fs')
    this.svgexport = Npm.require('svgexport')

    // dominus/.temp/hexes
    this.meteorPath = 'hexes/'

    this.s3prefix = 'hexes/'

    this.Future = Npm.require('fibers/future')
}


Mapbaker.prototype.bakeHexes = function() {
    var self = this

    console.log('--- baking hexes ---')

    self.resetImageCounter()

    var hexWidth = self.hexSize
    var hexHeight = self.hexSize * (Math.sqrt(3) * self.hexSquish)

    // find hex min/max
    var minX = Hexes.findOne({}, {sort:{x:1}, limit:1, fields:{x:1}}).x
    var minY = Hexes.findOne({}, {sort:{y:1}, limit:1, fields:{y:1}}).y
    var maxX = Hexes.findOne({}, {sort:{x:-1}, limit:1, fields:{x:1}}).x
    var maxY = Hexes.findOne({}, {sort:{y:-1}, limit:1, fields:{y:1}}).y

    // offset entire svg, transform group
    // to fit into image
    // var offsetX = self.hexSize
    // var offsetY = self.hexSize * (Math.sqrt(3) * self.hexSquish) / 2
    var offsetX = self.hexSize
    var offsetY = self.hexSize * (Math.sqrt(3) * self.hexSquish) * 2

    // offset pos of image on screen
    // var offsetPosX = offsetX * -1
    // var offsetPosY = offsetY * -1
    var offsetPosX = offsetX * -1
    var offsetPosY = offsetY * -1

    // size of image
    var svgWidth = Math.ceil(self.hexSize + (self.hexSize * 3/2 * (self.numHexes-1)) + (self.hexSize/2)) +2
    var numVerticalHexes = self.numHexes + ((self.numHexes-1)/2)
    //var svgHeight = Math.ceil((self.hexSize * (Math.sqrt(3) * self.hexSquish)) * numVerticalHexes)
    //var svgHeight = Math.ceil(hexHeight * self.numHexes + hexHeight)
    var svgHeight = Math.ceil(hexHeight * self.numHexes + hexHeight * 1.5) +2

    //delete files in temp dir and on s3
    self.deleteLocalFiles()
    Hexbakes.remove({})
    self.deleteS3Files()

    for (var x = minX; x <= maxX; x += self.numHexes) {
        for (var y = minY; y <= maxY; y += self.numHexes) {

            // keep track of how many images
            // for progress bar
            self.imageStarted()

            var gteX = x-1
            var ltX = x+self.numHexes+1
            var gteY = y - (self.numHexes / 3) * 2
            var ltY = y+self.numHexes+1

            var hexes = Hexes.find({x: {$gte:gteX, $lt:ltX}, y: {$gte:gteY, $lt:ltY}})
            var svg = ''

            svg += '<svg width="'+svgWidth+'" height="'+svgHeight+'" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink= "http://www.w3.org/1999/xlink">'

            // background
            svg += '<rect width="'+svgWidth+'" height="'+svgHeight+'" fill="#444" />'

            svg += '<g transform="translate('+offsetX+','+offsetY+')">'



            var filename = x+'_'+y

            // find max to save to Hexbakes
            var imageMaxX = x
            var imageMaxY = y

            hexes.forEach(function(hex) {
                if (hex.x > imageMaxX) {
                    imageMaxX = hex.x
                }
                if (hex.y > imageMaxY) {
                    imageMaxY = hex.y
                }
                svg += self.createSvg(hex, x, y)
            })

            svg += '</g>'
            svg += '</svg>'

            var pos = Hx.coordinatesToPos(x, y, self.hexSize, self.hexSquish)
            var imageObject = {
                minX: x,
                minY: y,
                maxX: imageMaxX,
                maxY: imageMaxY,
                centerX: Math.round((imageMaxX - x) / 2) + x,
                centerY: Math.round((imageMaxY - y) / 2) + y,
                filename: filename,
                posX: Math.round(pos.x + offsetPosX),
                posY: Math.round(pos.y + offsetPosY),
                width: svgWidth,
                height: svgHeight,
                created_at: new Date()
            }

            self.createImage(svg, filename, imageObject)
        }
    }
}


Mapbaker.prototype.createSvg = function(hex, x, y) {
    var self = this

    var svg = ''

    var pos = Hx.coordinatesToPos(hex.x-x, hex.y-y, self.hexSize, self.hexSquish)
    var points = Hx.getHexPolygonVerts(pos.x, pos.y, self.hexSize, self.hexSquish, false)

    // image
    if (hex.large) {
        var imageName = 'hex_'+hex.type+'_large_'+hex.tileImage+'.png'
    } else {
        var imageName = 'hex_'+hex.type+'_'+hex.tileImage+'.png'
    }
    imageName = Meteor.absoluteUrl()+'game_images/'+imageName
    var imageX = pos.x - 63
    var imageY = pos.y - 41
    svg += '<image x="'+imageX+'" y="'+imageY+'" width="126" height="83" xlink:href="'+imageName+'" />'

    // outline
    svg += '<polygon stroke="#628c6e" stroke-opacity="1" stroke-width="1" fill-opacity="0" points="'+points+'"></polygon>'

    // coord
    //svg += '<text x="'+pos.x+'" y="'+pos.y+'" fill="#000">'+hex.x+','+hex.y+'</text>'

    return svg
}


Mapbaker.prototype.deleteLocalFiles = function() {
    var self = this

    if (self.fs.existsSync(self.meteorPath)) {
        // delete all files in temp directory
        self.fs.readdirSync(self.meteorPath).forEach(function(file, index) {
            var curPath = self.meteorPath + '/' + file
            self.fs.unlinkSync(curPath);
        })
    } else {
        // create directory
        self.fs.mkdirSync(self.meteorPath)
    }
}


Mapbaker.prototype.deleteS3Files = function() {
    var self = this

    // don't return until done
    var fut = new self.Future()

    // delete all files on s3
    self.s3.list({ prefix: self.s3prefix }, function(error, data) {
        if (error) {
            throw new Meteor.Error(error)
        }

        var list = []

        for (var i=0; i<data.Contents.length; i++) {
            var name = data.Contents[i].Key
            if (name != self.s3prefix) {
                list.push(name)
            }
        }

        self.s3.deleteMultiple(list, function(error, result) {
            if (error) {
                throw new Meteor.Error(error)
            }

            fut['return'](true)
        })
    })

    return fut.wait()
}


Mapbaker.prototype.resetImageCounter = function() {
    Settings.upsert({name: 'mapBakeImagesStarted'}, {$set: {value:0}})
    Settings.upsert({name: 'mapBakeImagesFinished'}, {$set: {value:0}})
}


Mapbaker.prototype.imageStarted = function() {
    Settings.upsert({
        name: 'mapBakeImagesStarted'
    }, {
        $inc: {value:1}
    })
}


Mapbaker.prototype.imageFinished = function() {
    Settings.upsert({
        name: 'mapBakeImagesFinished'
    }, {
        $inc: {value:1}
    })
}


Mapbaker.prototype.createSvgImage = function(filepath, svgString) {
    var self = this
    var fut = new self.Future()
    self.fs.writeFile(filepath, svgString, Meteor.bindEnvironment(function(error) {
        if (error) {
            throw new Meteor.Error(error)
        }

        fut['return'](true)
    }))

    return fut.wait()
}


Mapbaker.prototype.createJpgImage = function(inFile, outFile, outFileType, quality) {
    var self = this
    var fut = new self.Future()
    self.svgexport.render([{
        'input': inFile,
        'output': outFile+' '+outFileType+' '+quality
    }], Meteor.bindEnvironment(function(error, result) {
        if (error) {
            console.log(error)
            throw new Meteor.Error(error)
        }

        fut['return'](true)
    }))
    return fut.wait()
}


Mapbaker.prototype.imageExists = function(image_url){
    check(image_url, String)

    try {
        var result = HTTP.get(image_url)
        return true
    } catch (error) {
        return false
    }

}

Mapbaker.prototype.createImage = function(svgString, name, imageObject) {
    var self = this

    var x = 0
    do {
        if (x > 0) {
            console.log('baking svg try '+x)
        }
        self.createSvgImage(self.meteorPath+name+'.svg', svgString)
        if (x > 10) {
            throw new Meteor.Error('Could not create svg after 10 tries.')
        }
        x++
    }
    while(!self.fs.existsSync(self.meteorPath+name+'.svg'))

    var x = 0
    do {
        if (x > 0) {
            console.log('baking jpg try '+x)
        }
        self.createJpgImage(self.meteorPath+name+'.svg', self.meteorPath+name+'.jpg', 'jpg', '75%')
        if (x > 10) {
            throw new Meteor.Error('Could not create jpg after 10 tries.')
        }
        x++
    }
    while(!self.fs.existsSync(self.meteorPath+name+'.jpg'))


    // upload to amazon s3
    self.fs.stat(self.meteorPath+name+'.jpg', Meteor.bindEnvironment(function(error, stat) {
        if (error) {
            throw new Meteor.Error(error)
        }

        if (!stat.isFile()) {
            throw new Meteor.Error('stat is not a file')
        }

        self.s3.putFile(self.meteorPath+name+'.jpg', 'hexes/'+name+'.jpg', {
            'Content-Length': stat.size,
            'Content-Type': 'image/jpg'
        }, Meteor.bindEnvironment(function(error, res) {
            if (error) {
                throw new Meteor.Error(error)
            } else {

                var imagepath = Meteor.settings.public.s3path+'/hexes/'+name+'.jpg'
                if (res.statusCode == 200 && self.imageExists(imagepath)) {
                    Hexbakes.insert(imageObject)
                    self.imageFinished()
                } else {
                    console.log('check of '+imagepath+' failed, retrying')
                    self.createImage(svgString, name, imageObject)
                }
            }
        }))
    }))
}
