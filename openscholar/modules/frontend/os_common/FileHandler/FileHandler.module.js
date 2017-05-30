/**
 * Contains functions that are commonly used across file handling modules.
 */

(function (ng) {

  var m = ng.module('FileHandler', []);

  m.service('FileHandlers', ['$upload', '$http', '$q', 'EntityConfig', '$timeout', function ($upload, $http, $q, config, $t) {
    this.getInstance = function (accepts, maxSizeStr, maxSizeRaw, uploadCallback) {
      var extensions = accepts,
          typeList,
          upload = [],
          validationErrors = [],
          checkingFilenames = false,
          upload, uploadProgress,
          messages = {},
          lastMessId = 0;

      function finalizeDupes(duplicates) {
        var toBeUploaded = [];
        for (var i in duplicates) {
          if (!duplicates[i].doNotUpload) {
            toBeUploaded.push(duplicates[i]);
          }
        }
        this.dupes = [];

        upload(toBeUploaded);
      }

      (function () {
        var toBeUploaded = [],
          uploading = false,
          progress = null,
          currentlyUploading = 0,
          uploaded = [];

        upload = function ($files) {
          for (var i=0; i<$files.length; i++) {
            toBeUploaded.push($files[i]);
          }

          if (!uploading && toBeUploaded.length) {
            uploading = true;
            $file = toBeUploaded[currentlyUploading];
            uploadOne($file);
          }
        }

        function uploadNext(firstId) {
          currentlyUploading++;
          if (currentlyUploading < toBeUploaded.length) {
            $file = toBeUploaded[currentlyUploading];
            uploadOne($file);
          }
          else {
            toBeUploaded = [];
            uploading = false;
            progress = null;
            currentlyUploading = 0;
            if (angular.isFunction(uploadCallback)) {
              uploadCallback(uploaded)
            }
            uploaded = [];
          }
        }

        function uploadOne($file) {
          var fields = {};
          if (Drupal.settings.spaces) {
            fields.vsite = Drupal.settings.spaces.id;
          }
          if (config.files) {
            for (var k in config.files.fields) {
              fields[k] = config.files.fields[k];
            }
          }
          $upload.upload({
            url: Drupal.settings.paths.api+'/files',
            file: $file,
            data: $file,
            fileFormDataName: 'files[upload]',
            headers: {'Content-Type': $file.type},
            method: 'POST',
            fields: fields,
            fileName: $file.newName || null
          }).progress(function (e) {
            progress = e;
          }).success(function (e) {
            for (var i = 0; i< e.data.length; i++) {
              uploaded.push(e.data[i]);
            }
            uploadNext(e.data[0].id);
          }).error(function (e) {
           // addMessage(e.title);
            uploadNext();
          });
        }

       uploadProgress = function () {
          return {
            uploading: uploading,
            filename: uploading ? toBeUploaded[currentlyUploading].filename : '',
            progressBar: (uploading && progress) ? parseInt(100.0 * progress.loaded / progress.total) : 0,
            index: currentlyUploading+1,
            numFiles: toBeUploaded.length
          }
        }
      })();

      return {
        dupes: [],
        'private': false,
        checkForDupes: function ($files, $event, $rejected) {
          var toBeUploaded = [];
          var toInsert = [];
          var promises = [];
          checkingFilenames = true;
          for (var i = 0; i < $files.length; i++) {

            // replace # in filenames cause they will break filename detection
            var newName = $files[i].name.replace(/[#|\?]/g, '_').replace(/__/g, '_').replace(/_\./g, '.');
            var hadHashtag = newName != $files[i].name;
            $files[i].sanitized = newName;

            var url = Drupal.settings.paths.api + '/files/filename/' + $files[i].sanitized;

            var urlParams = {};
            if (Drupal.settings.spaces) {
              urlParams['vsite'] = Drupal.settings.spaces.id;
            }
            if (this['private']) {
              urlParams['private'] = 'only';
            }

            var config = {
              originalFile: $files[i],
              params: urlParams,
            };
            var self = this;
            promises.push($http.get(url, config).then(function (response) {
                var file = response.config.originalFile;
                var data = response.data.data;
                file.filename = file.sanitized;
                if (data.collision) {
                  file.newName = data.expectedFileName;
                  self.dupes.push(file);
                }
                else {
                  if (data.invalidChars || hadHashtag) {
                    //addMessage("This file was renamed from \"" + file.name + "\" due to having invalid characters in its name. The new file will replace any file with the same name.");
                  }
                  toBeUploaded.push(file);
                }
              },
              function (errorResponse) {
                console.log(errorResponse);
              }));
          }

          var promise = $q.all(promises).then(function () {
              checkingFilenames = false;
              upload(toBeUploaded);
            },
            function () {
              checkingFilenames = false;
              console.log('Error happened with all promises');
            });
        },
        acceptString: function () {
          return '.' + extensions.join(',.');
        },
        validate: function (file) {
          if (file && file instanceof File) {
            // TODO: Get validating properties from somewhere and check the file against them

            var size = maxSizeRaw > file.size,   // file is smaller than max
              ext = file.name.slice(file.name.lastIndexOf('.')+1).toLowerCase(),
              extension = extensions.indexOf(ext) !== -1;    // extension is found

            if (!size) {
              var sizeId = lastMessId++;
              messages[sizeId] = {
                text: file.name + ' is larger than the maximum filesize of ' + (maxSizeStr)
              };
              $t(function () {
                delete messages[sizeId];
              }, 5000);
            }
            if (!extension) {
              var extId = lastMessId;
              messages[extId] = {
                text: file.name + ' is not an accepted file type.'
              }
              $t(function () {
                delete messages[extId];
              }, 5000);
            }

            return size && extension;
          }
        },
        messages: function () {
          return messages;
        },
        checkingFilenames: function () {
          return checkingFilenames;
        },
        hasDuplicates: function () {
          return this.dupes.length > 0;
        },
        rename: function ($index, $last) {
          this.dupes[$index].processed = true;

          if ($last) {
            finalizeDupes.call(this, this.dupes);
          }
        },
        replace: function ($index, $last) {
          this.dupes[$index].processed = true;
          delete this.dupes[$index].newName;

          if ($last) {
            finalizeDupes.call(this, this.dupes);
          }
        },
        cancel: function ($index, $last) {
          this.dupes[$index].doNotUpload = true;
          this.dupes[$index].processed = true;

          if ($last) {
            finalizeDupes.call(this, this.dupes);
          }
        },
        uploadProgress: uploadProgress
      }
    }
  }]);

  m.directive('fileUploadHandler', [function () {
    return {
      templateUrl: Drupal.settings.paths.FileHandler+'/FileUploadHandler.template.html?v='+Drupal.settings,
      scope: {
        fh: '='
      },
    };
  }]);

})(angular);
