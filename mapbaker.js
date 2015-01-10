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
    this.toPng = Npm.require('svg2png')

    // dominus/.temp/hexes
    this.meteorPath = 'hexes/'

    this.s3prefix = 'hexes/'

    this.Future = Npm.require('fibers/future')
}


Mapbaker.prototype.bakeHexes = function() {
    var self = this

    console.log('--- baking hexes ---')

    // find hex min/max
    var minX = Hexes.findOne({}, {sort:{x:1}, limit:1, fields:{x:1}}).x
    var minY = Hexes.findOne({}, {sort:{y:1}, limit:1, fields:{y:1}}).y
    var maxX = Hexes.findOne({}, {sort:{x:-1}, limit:1, fields:{x:1}}).x
    var maxY = Hexes.findOne({}, {sort:{y:-1}, limit:1, fields:{y:1}}).y

    // offset entire svg, transform group
    // to fit into image
    var offsetX = self.hexSize
    var offsetY = self.hexSize * (Math.sqrt(3) * self.hexSquish) / 2

    // offset pos of image on screen
    var offsetPosX = offsetX * -1
    var offsetPosY = offsetY * -1

    // size of svg image
    var svgWidth = self.hexSize + (self.hexSize * 3/2 * (self.numHexes-1)) + self.hexSize
    var numVerticalHexes = self.numHexes + ((self.numHexes-1)/2)
    var svgHeight = (self.hexSize * (Math.sqrt(3) * self.hexSquish)) * numVerticalHexes

    //delete files in temp dir and on s3
    self.deleteLocalFiles()
    Hexbakes.remove({})
    self.deleteS3Files()

    for (var x = minX; x <= maxX; x += self.numHexes) {
        for (var y = minY; y <= maxY; y += self.numHexes) {

            var hexes = Hexes.find({x: {$gte:x, $lt:x+self.numHexes}, y: {$gte:y, $lt:y+self.numHexes}})
            var svg = ''

            svg += '<svg width="'+svgWidth+'" height="'+svgHeight+'" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink= "http://www.w3.org/1999/xlink">'
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
                posX: pos.x + offsetPosX,
                posY: pos.y + offsetPosY,
                width: svgWidth,
                height: svgHeight
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


Mapbaker.prototype.createImage = function(svgString, name, imageObject) {
    var self = this

    // create svg file
    self.fs.writeFile(self.meteorPath+name+'.svg', svgString, Meteor.bindEnvironment(function(error) {
        if (error) {
            throw new Meteor.Error(error)
        }

        // convert to png
        self.toPng(self.meteorPath+name+'.svg', self.meteorPath+name+'.png', Meteor.bindEnvironment(function(error) {
            if (error) {
                throw new Meteor.Error(error)
            }

            // upload to amazon s3
            self.fs.stat(self.meteorPath+name+'.png', Meteor.bindEnvironment(function(error, stat) {
                if (error) {
                    throw new Meteor.Error(error)
                }

                self.s3.putFile(self.meteorPath+name+'.png', 'hexes/'+name+'.png', {
                    'Content-Length': stat.size,
                    'Content-Type': 'image/png'
                }, Meteor.bindEnvironment(function(error, res) {
                    if (error) {
                        throw new Meteor.Error(error)
                    } else {
                        res.resume()
                        Hexbakes.insert(imageObject)
                    }
                }))
            }))
        }))
    }))
}
