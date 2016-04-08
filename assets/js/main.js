var flog = function () {
    if (typeof (console) !== 'undefined') {
        if (navigator.appName == 'Microsoft Internet Explorer') {
            if (arguments.length == 1) {
                console.log(arguments[0]);
            } else if (arguments.length == 2) {
                console.log(arguments[0], arguments[1]);
            } else if (arguments.length > 2) {
                console.log(arguments[0], arguments[1], arguments[2]);
            }
        } else {
            console.log(arguments);
        }
    }
};

$(function () {
    $('#type').on('change', function () {
        $('.file-wrapper, .link-wrapper').hide();
        $('.' + this.value).show();
    });

    $('#file').on('change', function (e) {
        var files = e.target.files;
        if (!files || files.length === 0) {
            return;
        }

        var page = $('#page').val();

        var fileReader = new FileReader();
        fileReader.onload = function webViewerChangeFileReaderOnload(evt) {
            var buffer = evt.target.result;
            flog('Buffer: ', buffer);
            var uint8Array = new Uint8Array(buffer);
            flog('Uint8Array: ', uint8Array);

            readPDFData(uint8Array, page);
        };

        var file = files[0];
        fileReader.readAsArrayBuffer(file);
    });

    $('#link').on('change', function () {
        flog('Get data from: ' + this.value);

        var xhr = new XMLHttpRequest();
        xhr.open('GET', this.value, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = (function () {
            flog('Success in getting data', xhr.response);

            var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
            var page = $('#page').val();
            readPDFData(data, page);
        }).bind(this);
        xhr.send(null);
    });

    $('#save').on('click', function (e) {
        e.preventDefault();

        var result = $('#result').text() || '';
        result = result.trim();

        if (result) {
            var element = document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(result));
            element.setAttribute('download', 'data.json');

            element.style.display = 'none';
            document.body.appendChild(element);

            element.click();

            document.body.removeChild(element);
        }
    });
});

function readPDFData(data, pageNumber) {
    var result = $('#result');
    result.html('');

    var pdf = new PDFDocument(null, data);
    pdf.parseStartXRef();
    pdf.parse();

    var xref = pdf.xref;
    var trailer = xref.trailer;
    flog('Trailer', trailer);

    var json = {
        Pages: []
    };

    var root = getRefData(trailer, 'Root');
    flog('Root', root);

    json.OCGs = getOCGs(root);

    var pages = getRefData(root, 'Pages');
    pages = pages.map.Kids;
    flog('Pages', pages);

    if (pageNumber && !isNaN(pageNumber) && +pageNumber > 0) {
        flog('Page number: ' + pageNumber);

        if (pageNumber < pages.length) {
            flog('Page number does exist');
            var page = getPage(root, pages[pageNumber], pageNumber);
            json.Pages.push(page);
        } else {
            flog('Page number does not exist');
        }
    } else {
        flog('Page number is invalid. Get all pages');

        for (var i = 0; i < pages.length; i++) {
            var page = getPage(root, pages[i], i);

            json.Pages.push(page);
        }
    }

    var jsonString = JSON.stringify(json, null, '  ');
    jsonString = jsonString.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    result.html(jsonString).removeClass('prettyprintted');
    prettyPrint();
}

function getName(obj) {
    var name = obj.name + '';
    if (name.startsWith('\u00FE\u00FF')) {
        // Text encoded as UTF-16BE bytes, see §7.9.2.2 "Text String Type" of PDF 32000-1:2008
        // https://wwwimages2.adobe.com/content/dam/Adobe/en/devnet/pdf/pdfs/PDF32000_2008.pdf#G6.1957385
        var decoded = '';
        for (var i = 2; i < name.length; i += 2) {
            decoded += String.fromCharCode(name.charCodeAt(i) << 8 | name.charCodeAt(i + 1));
        }
        name = decoded;
    }

    return name;
}

function getPage(root, page, pageNumber) {
    flog('getPage', root, page, pageNumber);

    var data = {
        Number: pageNumber,
        Colors: {},
        Fonts: {}
    };

    var boxNames = ['ArtBox', 'TrimBox', 'BleedBox', 'CropBox', 'MediaBox'];
    flog('Get data of: ' + boxNames.join(', '));
    var pageData = getRefData(root, page);
    for (var i = 0; i < boxNames.length; i++) {
        var boxName = boxNames[i];

        if (boxName in pageData.map) {
            data[boxName + 'es'] = pageData.map[boxName];
        }
    }

    var resources = pageData.map.Resources;
    if (isRef(resources)) {
        resources = getRefData(root, resources);
    }

    if (resources && resources.map) {
        flog('Read Resources data', resources);

        if (resources.map.Font) {
            var fonts = resources.map.Font.map;
            flog('Get Font data', fonts);

            for (var fontName in fonts) {
                var font = getRefData(resources, fonts[fontName]);
                var fontData = {
                    BaseFont: '/' + getName(font.map.BaseFont),
                    Subtype: '/' + getName(font.map.Subtype),
                    Type: '/' + getName(font.map.Type)
                };

                var fontDescriptor = getRefData(font, 'FontDescriptor');
                if (fontDescriptor) {
                    flog('FontDescriptor: ', fontDescriptor);
                    fontData.FontDescriptor = {
                        Ascent: fontDescriptor.map.Ascent,
                        CapHeight: fontDescriptor.map.CapHeight,
                        Descent: fontDescriptor.map.Descent,
                        FontFamily: fontDescriptor.map.FontFamily,
                        FontName: '/' + getName(fontDescriptor.map.FontName),
                        FontWeight: fontDescriptor.map.FontWeight,
                        ItalicAngle: fontDescriptor.map.ItalicAngle,
                        XHeight: fontDescriptor.map.XHeight
                    };
                } else {
                    flog('FontDescriptor does not exist');
                }

                data.Fonts[fontName] = fontData;
            }
        } else {
            flog('Font inside Resources does not exist');
        }

        if (resources.map.ColorSpace) {
            var colors = resources.map.ColorSpace.map;
            flog('Get ColorSpace data', colors);

            for (var colorName in colors) {
                var color = getRefData(resources, colors[colorName]);
                flog('color', color);

                var colorData = [];
                for (var i = 0; i < color.length; i++) {
                    var _color = color[i];
                    var _colorData = getColorData(resources, _color);

                    colorData.push(_colorData);
                }

                data.Colors[colorName] = colorData;
            }
        } else {
            flog('ColorSpace inside Resources does not exist');
        }
    } else {
        flog('Resources are empty', resources);
    }


    flog('getPage =>', data);

    return data;
}

function getColorData(resources, color) {
    flog('getColorData', resources, color);

    var data;

    if (isRef(color)) {
        color = getRefData(resources, color);
        data = getColorData(resources, color)
    } else if (isArray(color)) {
        var _colorNames = [];
        for (var j = 0; j < color.length; j++) {
            _colorNames.push(getColorData(resources, color[j]));
        }
        data = _colorNames;
    } else if (isStream(color)) {
        data = '<stream>';
    }  else if (isDict(color)) {
        data = '<dict>';
    } else if (isInt(color)) {
        data = color + '';
    } else {
        data = '/' + getName(color);
    }

    return data;
}

function getRefData(root, name) {
    flog('getRefData', root, name);

    var data;
    var obj;

    if (typeof name === 'string') {
        obj = root.map[name];
    } else {
        obj = name;
    }

    if (obj) {
        data = root.xref.fetch(obj);
    }

    flog('getRefData =>', data);

    return data;
}

function getOCGs(root) {
    flog('getOCGs', root);

    var ocgs = [];
    var ocProperties = root.map.OCProperties;
    if (ocProperties) {
        flog('OCGs', ocProperties.map.OCGs);

        for (var i = 0; i < ocProperties.map.OCGs.length; i++) {
            var ocg = ocProperties.map.OCGs[i];
            ocg = getRefData(ocProperties, ocg);

            ocgs.push({
                Name: getName({name: ocg.map.Name}),
                Type: '/' + getName(ocg.map.Type)
            });
        }
    }

    flog('getOCGs =>', ocgs);

    return ocgs;
}

