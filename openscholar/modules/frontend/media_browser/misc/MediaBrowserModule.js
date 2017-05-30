(function ($) {
  var rootPath,
    open = angular.noop;

  angular.module('mediaBrowser', ['JSPager', 'EntityService', 'os-auth', 'ngSanitize', 'angularFileUpload',
      'angularModalService', 'FileEditor', 'mediaBrowser.filters', 'locationFix', 'FileHandler'])
    .config(['EntityDatabaseServiceProvider', function (edbProvider) {
       rootPath = Drupal.settings.paths.moduleRoot;

      edbProvider.AddConfig('allFiles', {
        entityType: 'files',
      });

      edbProvider.AddConfig('privateFiles', {
        entityType: 'files',
        params: {
          'private': 'only'
        }
      });
    }])
    .run(['mbModal', 'FileEditorOpenModal', function (mbModal, feom) {
      // Disable drag and drop behaviors on the window object, to prevent files
      // from replacing the window.
      angular.element(window).on('dragover drop', function(e) {
        e = e || event;
        e.preventDefault();
      });

      // if the File object is not supported by this browser, fallback to the
      // original media browser.
      if (mbModal.requirementsMet()) {
        Drupal = Drupal || {};
        Drupal.media = Drupal.media || {};
        Drupal.media.popups = Drupal.media.popups || {};
        var oldPopup = Drupal.media.popups.mediaBrowser;
        Drupal.media.popups.mediaBrowserOld = oldPopup;
        Drupal.media.popups.mediaBrowser = function (onSelect, globalOptions, pluginOptions, widgetOptions) {
          var options = Drupal.media.popups.mediaBrowser.getDefaults();
          options.global = $.extend({}, options.global, globalOptions);
          options.plugins = pluginOptions;
          options.widget = $.extend({}, options.widget, widgetOptions);


          // Params to send along to the iframe. WIP.
          var params = {};
          $.extend(params, options.global);
          params.plugins = options.plugins;
          params.onSelect = onSelect;

          mbModal.open(params);
        };

        for (var k in oldPopup) {
          if (!Drupal.media.popups.mediaBrowser[k]) {
            Drupal.media.popups.mediaBrowser[k] = oldPopup[k];
          }
        }

        var oldStyleSelector = Drupal.media.popups.mediaStyleSelector;
        Drupal.media.popups.mediaStyleSelector = function (file, onSelect, options) {
          if (file.type == 'media') {
            feom.open(file.fid, function () {
              onSelect();
            });
          }
          else {
            oldStyleSelector(file, onSelect, options);
          }
        };

        for (var k in oldStyleSelector) {
          Drupal.media.popups.mediaStyleSelector[k] = oldStyleSelector[k];
        }
      }
    }])
  .controller('BrowserCtrl', ['$scope', '$filter', '$http', 'EntityDatabaseService', '$sce', '$q', '$upload',
      '$timeout', 'FILEEDITOR_RESPONSES', 'FileHandlers', 'params', 'close',
      function ($scope, $filter, $http, edb, $sce, $q, $upload, $timeout, FER, FileHandlers, params, close) {

    // Initialization
    var toEditForm = false,
      directInsert = true;
    $scope.files = [];
    $scope.numFiles = 0;
    $scope.templatePath = rootPath;
    $scope.selection = 0;
    $scope.form = '';
    $scope.pane = 'upload';
    $scope.toBeUploaded = [];
    $scope.dupes = [];
    $scope.showButtons = false;
    $scope.params = params.browser;
    $scope.editing = false;
    $scope.deleting = false;
    $scope.activePanes = params.browser.panes;
    $scope.activePanes.edit = true;
    $scope.activePanes.delete = true;
    $scope.sortType = 'timestamp';
    $scope.sortReverse = true;
    $scope.button_text = params.replace ? 'Select Replacement File' : 'Select files to Add';

    $scope.toInsert = [];

    /**
     * Set up the EntityDatabase for files.
     * @type {string}
     */
    var db = edb.files;
    if (db) {
      $scope.db = db.allFiles;
      if (params.private) {
        $scope.db = db.privateFiles;
      }
    }

    /**
     * Extension handling
     */

    var allTypes = [
      {label: 'Image', value: 'image'},
      {label: 'Document', value: 'document'},
      {label: 'Video', value: 'video'},
      {label: 'HTML', value: 'html'},
      {label: 'Executable', value: 'executable'},
      {label: 'Audio', value: 'audio'},
      {label: 'Icon', value: 'icon'}
    ];

    var defaultFilteredTypes = params.types;
    $scope.availTypes = [];
    $scope.availFilter = [];
    for (var j in defaultFilteredTypes) {
      for (var k=0; k<allTypes.length; k++) {
        if (defaultFilteredTypes[j] == allTypes[k].value) {
          $scope.availTypes.push(allTypes[k]);
          $scope.availFilter.push(allTypes[k].value);
        }
      }
    }

    $scope.extensions = [];
    if (params.file_extensions) {
      $scope.extensions = params.file_extensions.split(' ');
    }
    if (!params.override_extensions) {
      var types = params.types;
      for (var t in types) {
        var ext = Drupal.settings.extensionMap[types[t]],
          i = 0, l = ext ? ext.length : false;

        if (!ext) continue;

        for (var i=0; i<l; i++) {
          if ($scope.extensions.indexOf(ext[i]) === -1) {
            $scope.extensions.push(ext[i]);
          }
        }
      }
    }
    $scope.extensions.sort();

    /**
     * URL whitelist for embeds.
     */
    $scope.whitelist = Drupal.settings.embedWhitelist;

    /**
     * Setting the maximum file size
     */
    if (params.max_filesize) {
      $scope.maxFilesize = params.max_filesize;
    }
    else {
      $scope.maxFilesize = Drupal.settings.maximumFileSize;
    }

    /**
     * Setting up the File Upload Handler
     */
    var uploadBatch = [];
    $scope.fh = FileHandlers.getInstance($scope.extensions,
      $scope.maxFilesize,
      params.max_filesize_raw || Drupal.settings.maximumFileSizeRaw,
      function ($files, messages) {
        for (var i = 0; i < $files.length; i++) {
          $files[i].new = true;
          db.register($files[i]);
        }
        uploadBatch = uploadBatch.concat($files);
        if (!$scope.fh.hasDuplicates()) {
          if (toEditForm) {
            // there's only one file. Go to the edit page automatically
            $scope.setSelection($files[0].id);
            $scope.changePanes('edit');
          }
          else {
            if (directInsert) {
              $scope.insert(uploadBatch);
            }
            else {
              $scope.changePanes('library');
            }
          }
          uploadBatch = [];
        }
      });

    if (params.private) {
      $scope.fh.private = true;
    }

    /**
     * Set up filters
     */
    $scope.filteredTypes = [];
    $scope.isFiltered = function () {
      return $scope.filteredTypes.length || $scope.search;
    }

    $scope.clearFilters = function () {
      $scope.filteredTypes = defaultFilteredTypes;
      $scope.search = '';
    }

    $scope.showHelp = false;

    if (close) {
      $scope.showButtons = true;
    }

    $scope.messages = {
      next: 0
    };

    /**
     * Event handler for changing tab panes
     */
    $scope.changePanes = function (pane, result) {
      if ($scope.activePanes[pane]) {
        $scope.pane = pane;
        return true;
      }
      else {
        close(result != undefined ? result : true);
      }
    }

    function addMessage(message) {
      var id = $scope.messages.next++;
      $scope.messages[id] = {
        text: message
      };
      $timeout(angular.bind($scope, removeMessage, id), 5000);
    }

    function removeMessage(id) {
      delete this.messages[id];
    }

    $scope.handleFileChange = function ($files, $event, $rejected) {
      if ($files.length == 1) {
        toEditForm = true;
      }

      var passAlong = [];
      for (var i = 0; i < $files.length; i++) {
        if (params.replace) {
          if (params.replace.filename == $files[i].name) {
            // the fact that replace is set means we're trying to Replace a certain file
            // If the file in question has the same name as the new one, just skip all the duplicate
            // processing and upload it immediately.
            $files[i].replacing = params.replace;
            toEditForm = false;
            directInsert = true;
            $scope.fh.upload([$files[i]]);
            continue;
          }
        }

        passAlong.push($files[i]);
      }
      $scope.fh.checkForDupes(passAlong, $event, $rejected);
    }

    function getKeyForFile(fid) {
      var files = $scope.db.Entities();
      for (var i=0; i<files.length; i++) {
        if (files[i].id == fid) {
          return i;
        }
      }
      return false;
    }

    function getFileById(fid) {
      var files = $scope.db.Entities();
      for (var i=0; i<files.length; i++) {
        if (files[i].id == fid) {
          return files[i];
        }
      }
      return false;
    }

    // selected file
    $scope.setSelection = function (fid) {
      var file = getFileById(fid);
      if (file !== false) {
        $scope.selection = fid;
        $scope.selected_file = file;
      }
    };

    $scope.deleteConfirmed = function() {
      $scope.db.delete($scope.selected_file);
      $scope.changePanes('library');
    };


    $scope.embed = '';
    $scope.embedSubmit = function () {
      // construct the entity
      var data = {
        embed: this.embed,
      }

      $scope.db.create(data).then(function (file) {
        $scope.embed = '';
        e.data[0].new = e.data[0].changed == e.data[0].timestamp;
        $scope.setSelection(e.data[0].id);
        db.register(e.data[0]);

        $scope.changePanes('edit')
      }, function (e) {
        $scope.embedFailure = true;
          $timeout(function () {
            $scope.embedFailure = false;
          }, 5000);
      });
    }

    $scope.closeFileEdit = function (result) {
      if (result == FER.CANCELED && $scope.selected_file.new) {
        $scope.db.delete($scope.selected_file);
        for (var j = 0; j < $scope.files.length; j++) {
          if ($scope.files[j].id == $scope.selected_file.id) {
            $scope.files[j].status = 'deleting';
          }
        }
        $scope.selected_file = null;
      }
      else if ((result == FER.NO_CHANGES || result == FER.SAVED) && ($scope.selected_file.new || $scope.selected_file.replaced)) {
        if (directInsert) {
          $scope.insert([$scope.selected_file]);
        }
        else {
          $scope.changePanes('library', result);
        }
        return;
      }
      $scope.changePanes('library', result);
    }

    $scope.insert = function ($files) {
      var results = [];
      for (var i = 0; i < $files.length; i++) {
        $files[i].fid = $files[i].id;
      }

      close($files);
    }

    $scope.cancel = function () {
      close([]);
    }

    // when a set of files are passed to the Media Browser, they were handled by some other service and then passed
    // to the Media Browser to handle
    if (params.files) {
      var accepted = [], rejected = [];
      for (var i=0; i<params.files.length; i++) {
        if ($scope.validate(params.files[i])) {
          accepted.push(params.files[i]);
        }
        else {
          rejected.push(params.files[i]);
        }
      }
      $scope.fh.checkForDupes(accepted, {}, rejected);
    }
  }])
  .directive('mbOpenModal', ['$parse', 'mbModal', function($parse, mbModal) {

    function link(scope, elem, attr, contr) {
      elem.bind('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        // get stuff from the element we clicked on and Drupal.settings
        var elem = event.currentTarget,
          params = mbModal.defaultParams(),
          panes = elem.attributes['panes'].value,
          types = elem.attributes['types'].value.split(','),
          privateFiles = !!elem.attributes['private'];

        if (attr['replace']) {
          var prop = attr['replace'];
          params.replace = scope[prop];
        }

        for (var i in params.browser.panes) {
          params.browser.panes[i] = (panes.indexOf(i) !== -1);
        }

        params.types = {}
        for (i=0; i<types.length;i++) {
          params.types[types[i]] = types[i];
        }

        params.onSelect = function (inserted) {
          if (elem.attributes['on-select'].value) {
            $parse(elem.attributes['on-select'].value)(scope, {
              $inserted: inserted
            });
          }
          else {
            window.location.reload();
          }
        }

        params['private'] = privateFiles;

        mbModal.open(params);
      });
    }

    return {
      template: '<ng-transclude></ng-transclude>',
      link: link,
      transclude: true
    }
  }])
  .service('mbModal', ['ModalService', function (ModalService) {
      this.defaultParams = function () {
        var params = {
          dialog: {
            buttons: {},
            dialogClass: 'media-wrapper',
            modal: true,
            draggable: false,
            resizable: false,
            minWidth: 600,
            width: 800,
            height: 650,
            position: 'center',
            title: undefined,
            overlay: {
              backgroundColor: '#000000',
              opacity: 0.4
            },
            zIndex: 10000,
            close: function (event, ui) {
              $(event.target).remove();
            }
          },
          browser: {
            panes: {
              web: true,
              upload: true,
              library: true
            }
          },
          onSelect: angular.noop,
          types: {
            image: 'image',
            video: 'video',
            audio: 'audio',
            executable: 'executable',
            document: 'document',
            html: 'html'
          },
          replace: false,
          'private': false,
        };

        return params;
      }

      this.requirementsMet = function() {
        return (window.File && window.FormData);
      }

      this.open = function (params) {
        var defaults = this.defaultParams(),
          nparams = {
            dialog: angular.extend([], defaults.dialog, params.dialog),
            browser: angular.extend({}, defaults.browser, params.browser),
            onSelect: params.onSelect || defaults.onSelect,
            types: params.types || defaults.types,
            max_filesize: params.max_filesize || null,
            max_filesize_raw: params.max_filesize_raw || null,
            replace: params.replace || defaults.replace,
            'private': params.private || defaults.private
        };

        if (params.files) {
          nparams.files = params.files;
        }

        ModalService.showModal({
          templateUrl: rootPath+'/templates/browser.html?vers='+Drupal.settings.version.mediaBrowser,
          controller: 'BrowserCtrl',
          inputs: {
            params: nparams
          }
        }).then(function (modal) {
          modal.element.dialog(nparams.dialog);
          modal.close.then(function (result) {
            // run the function passed to us
            if (Array.isArray(result)) {
              if (result.length) {
                nparams.onSelect(result);
              }
            }
            else if (result) {
              nparams.onSelect(result);
            }
          });
        });
      }
  }]);
})(jQuery);
