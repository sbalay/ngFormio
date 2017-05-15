var fs = require('fs');
var _get = require('lodash/get');
var _cloneDeep = require('lodash/cloneDeep');

module.exports = function(app) {
  app.directive('formioSelectBoxes', [function() {
    return {
      restrict: 'E',
      replace: true,
      require: 'ngModel',
      scope: {
        component: '=',
        selectItems: '=',
        componentId: '=',
        readOnly: '=',
        model: '=ngModel',
        gridRow: '=',
        gridCol: '=',
        builder: '=?'
      },
      templateUrl: 'formio/components/selectboxes-directive.html',
      link: function($scope, el, attrs, ngModel) {
        if ($scope.builder) return;
        // Initialize model

        $scope.getItemValue = function(item) {
          return item[$scope.component.valueProperty] || item.value || item;
        };

        $scope.getItemLabel = function(item) {
          return item[$scope.component.labelProperty] || item.label || item;
        };

        var model = {};
        angular.forEach($scope.selectItems, function(item) {
          var val = $scope.getItemValue(item);
          model[val] = ngModel.$viewValue.hasOwnProperty(val)
            ? !!ngModel.$viewValue[val]
            : false;
        });
        // FA-835 - Update the view model with our defaults.
        // FA-921 - Attempt to load a current model, if present before the defaults.
        ngModel.$setViewValue($scope.model || model);


        ngModel.$setPristine(true);
        ngModel.$isEmpty = function(value) {
          if (typeof value === 'undefined') {
            return true;
          }

          return Object.keys(value).every(function(key) {
            return !value[key];
          });
        };

        $scope.toggleCheckbox = function(value) {
          var _model = angular.copy(ngModel.$viewValue || {});
          _model[value] = !_model[value];
          ngModel.$setViewValue(_model);
        };
      }
    };
  }]);

  app.config([
    'formioComponentsProvider',
    function(formioComponentsProvider) {
      formioComponentsProvider.register('selectboxes', {
        title: 'Select Boxes',
        template: 'formio/components/selectboxes.html',
        tableView: function(data, component) {
          var getItem = function(data) {
            switch (component.dataSrc) {
              case 'values':
                component.data.values.forEach(function(item) {
                  if (item.value === data) {
                    data = item;
                  }
                });
                return data;
              case 'json':
                if (component.valueProperty) {
                  var selectItems;
                  try {
                    selectItems = angular.fromJson(component.data.json);
                  }
                  catch (error) {
                    selectItems = [];
                  }
                  selectItems.forEach(function(item) {
                    if (item[component.valueProperty] === data) {
                      data = item;
                    }
                  });
                }
                return data;
              // TODO: implement url and resource view.
              case 'url':
              case 'resource':
              default:
                return data;
            }
          };
          var result = Array.isArray(data) ? data.map(getItem) : getItem(data);
          return Object.keys(result).join(', ');
        },
        controller: [
          '$rootScope',
          '$scope',
          '$http',
          'Formio',
          '$interpolate',
          '$q',
          '$timeout',
          function(
            $rootScope,
            $scope,
            $http,
            Formio,
            $interpolate,
            $q,
            $timeout
          ) {
            // FOR-71 - Skip functionality in the builder view.
            if ($scope.builder) return;
            var settings = $scope.component;
            var options = {};
            $scope.nowrap = true;
            $scope.hasNextPage = false;
            $scope.selectItems = [];

            var initialized = $q.defer();
            initialized.promise.then(function() {
              $scope.$emit('datasourceLoaded', $scope.component);
            });

            var selectValues = $scope.component.selectValues;
            var valueProp = $scope.component.valueProperty;
            $scope.getSelectItem = function(item) {
              if (!item) {
                return '';
              }
              if (settings.dataSrc === 'values') {
                return item.value;
              }

              // Get the item value.
              var itemValue = valueProp ? _get(item, valueProp) : item;
              if (itemValue === undefined) {
                /* eslint-disable no-console */
                console.warn('Cannot find value property within select: ' + valueProp);
                /* eslint-enable no-console */
              }
              return itemValue;
            };

            $scope.refreshItems = function() {
              return $q.resolve([]);
            };
            $scope.$on('refreshList', function(event, url, input) {
              $scope.refreshItems(input, url);
            });

            var refreshing = false;
            var refreshValue = function() {
              if (refreshing) {
                return;
              }
              refreshing = true;
              var tempData = $scope.data[settings.key];
              $scope.data[settings.key] = '';
              if (!settings.clearOnRefresh) {
                $timeout(function() {
                  $scope.data[settings.key] = tempData;
                  refreshing = false;
                  $scope.$emit('datasourceLoaded', $scope.component);
                });
              }
              else {
                refreshing = false;
                $scope.$emit('datasourceLoaded', $scope.component);
              }
            };

            // Refresh the items when ready.
            var refreshItemsWhenReady = function() {
              initialized.promise.then(function() {
                var refreshPromise = $scope.refreshItems(true);
                if (refreshPromise) {
                  refreshPromise.then(refreshValue);
                }
                else {
                  refreshValue();
                }
              });
            };

            // Add a watch if they wish to refresh on selection of another field.
            if (settings.refreshOn) {
              if (settings.refreshOn === 'data') {
                $scope.$watch('data', refreshItemsWhenReady, true);
                return;
              }

              $scope.$watch('data.' + settings.refreshOn, refreshItemsWhenReady);
              $scope.$watch('submission.data.' + settings.refreshOn, refreshItemsWhenReady);
            }
            else {
              // Watch for the data to be set, and ensure the value is set properly.
              var dataWatch = $scope.$watch('data.' + settings.key, function(value) {
                if (value) {
                  initialized.promise.then(function() {
                    dataWatch();
                    refreshValue();
                  });
                }
              });
            }

            $scope.getItemValue = function(item) {
              return item[settings.valueProperty] || item.value || item;
            };

            $scope.getItemLabel = function(item) {
              return item[settings.labelProperty] || item.label || item;
            };

            switch (settings.dataSrc) {
              case 'values':
                $scope.selectItems = settings.data.values;
                initialized.resolve();
                break;
              case 'json':
                var items;

                // Set the new result.
                var setResult = function(data, append) {
                  // coerce the data into an array.
                  if (!(data instanceof Array)) {
                    data = [data];
                  }

                  if (data.length < options.params.limit) {
                    $scope.hasNextPage = false;
                  }
                  if (append) {
                    $scope.selectItems = $scope.selectItems.concat(data);
                  }
                  else {
                    $scope.selectItems = data;
                  }
                };

                try {
                  if (typeof $scope.component.data.json === 'string') {
                    items = angular.fromJson($scope.component.data.json);
                  }
                  else if (typeof $scope.component.data.json === 'object') {
                    items = $scope.component.data.json;
                  }
                  else {
                    items = [];
                  }

                  if (selectValues) {
                    // Allow dot notation in the selectValue property.
                    if (selectValues.indexOf('.') !== -1) {
                      var parts = selectValues.split('.');
                      var select = items;
                      for (var i in parts) {
                        select = select[parts[i]];
                      }
                      items = select;
                    }
                    else {
                      items = items[selectValues];
                    }
                  }
                }
                catch (error) {
                  /* eslint-disable no-console */
                  console.warn('Error parsing JSON in ' + $scope.component.key, error);
                  /* eslint-enable no-console */
                  items = [];
                }
                options.params = {
                  limit: $scope.component.limit || 20,
                  skip: 0
                };

                var lastInput;
                $scope.refreshItems = function(input, url, append) {
                  // If they typed in a search, reset skip.
                  if (lastInput !== input) {
                    lastInput = input;
                    options.params.skip = 0;
                  }
                  var selectItems = items;
                  if (input) {
                    selectItems = selectItems.filter(function(item) {
                      // Get the visible string from the interpolated item.
                      var value = $interpolate($scope.component.template)({item: item}).replace(/<(?:.|\n)*?>/gm, '');
                      switch ($scope.component.filter) {
                        case 'startsWith':
                          return value.toLowerCase().indexOf(input.toLowerCase()) !== -1;
                        case 'contains':
                        default:
                          return value.toLowerCase().lastIndexOf(input.toLowerCase(), 0) === 0;
                      }
                    });
                  }
                  options.params.skip = parseInt(options.params.skip, 10);
                  options.params.limit = parseInt(options.params.limit, 10);
                  selectItems = selectItems.slice(options.params.skip, options.params.skip + options.params.limit);
                  setResult(selectItems, append);
                  return initialized.resolve($scope.selectItems);
                };
                $scope.refreshItems();
                break;
              case 'custom':
                $scope.refreshItems = function() {
                  try {
                    /* eslint-disable no-unused-vars */
                    var data = _cloneDeep($scope.submission.data);
                    var row = _cloneDeep($scope.data);
                    /* eslint-enable no-unused-vars */
                    $scope.selectItems = eval('(function(data, row) { var values = [];' + settings.data.custom.toString() + '; return values; })(data, row)');
                  }
                  catch (error) {
                    $scope.selectItems = [];
                  }
                  return initialized.resolve($scope.selectItems);
                };
                $scope.refreshItems();
                break;
              case 'url':
              case 'resource':
                var url = '';
                if (settings.dataSrc === 'url') {
                  url = settings.data.url;
                  if (url.substr(0, 1) === '/') {
                    url = Formio.getBaseUrl() + settings.data.url;
                  }

                  // Disable auth for outgoing requests.
                  if (!settings.authenticate && url.indexOf(Formio.getBaseUrl()) === -1) {
                    options.disableJWT = true;
                    options.headers = options.headers || {};
                    options.headers.Authorization = undefined;
                    options.headers.Pragma = undefined;
                    options.headers['Cache-Control'] = undefined;
                  }
                }
                else {
                  url = Formio.getBaseUrl();
                  if (settings.data.project) {
                    url += '/project/' + settings.data.project;
                  }
                  url += '/form/' + settings.data.resource + '/submission';
                }

                options.params = {
                  limit: $scope.component.limit || 100,
                  skip: 0
                };

                $scope.loadMoreItems = function($select, $event) {
                  $event.stopPropagation();
                  $event.preventDefault();
                  options.params.skip = parseInt(options.params.skip, 10);
                  options.params.skip += parseInt(options.params.limit, 10);
                  $scope.refreshItems(true, null, true);
                };

                if (url) {
                  $scope.hasNextPage = true;
                  $scope.refreshItems = function(input, newUrl, append) {
                    if (!input) {
                      return;
                    }

                    newUrl = newUrl || url;
                    newUrl = $interpolate(newUrl)({
                      data: $scope.data,
                      formioBase: $rootScope.apiBase || 'https://api.form.io'
                    });
                    if (!newUrl) {
                      return;
                    }

                    // If this is a search, then add that to the filter.
                    if (
                      settings.searchField &&
                      (typeof input === 'string') &&
                      input
                    ) {
                      newUrl += ((newUrl.indexOf('?') === -1) ? '?' : '&') +
                        encodeURIComponent(settings.searchField) +
                        '=' +
                        encodeURIComponent(input);
                    }

                    // Add the other filter.
                    if (settings.filter) {
                      var filter = $interpolate(settings.filter)({data: $scope.data});
                      newUrl += ((newUrl.indexOf('?') === -1) ? '?' : '&') + filter;
                    }

                    // If they wish to return only some fields.
                    if (settings.selectFields) {
                      options.params.select = settings.selectFields;
                    }

                    // Set the new result.
                    var setResult = function(data) {
                      // coerce the data into an array.
                      if (!(data instanceof Array)) {
                        data = [data];
                      }

                      if (data.length < options.params.limit) {
                        $scope.hasNextPage = false;
                      }
                      if (append) {
                        $scope.selectItems = $scope.selectItems.concat(data);
                      }
                      else {
                        $scope.selectItems = data;
                      }
                    };

                    return $http.get(newUrl, options).then(function(result) {
                      var data = result.data;
                      if (data) {
                        // If the selectValue prop is defined, use it.
                        if (selectValues) {
                          setResult(_get(data, selectValues, []));
                        }
                        // Attempt to default to the formio settings for a resource.
                        else if (data.hasOwnProperty('data')) {
                          setResult(data.data);
                        }
                        else if (data.hasOwnProperty('items')) {
                          setResult(data.items);
                        }
                        // Use the data itself.
                        else {
                          setResult(data);
                        }
                      }
                      return $scope.selectItems;
                    }).finally(function() {
                      initialized.resolve($scope.selectItems);
                    });
                  };
                  $scope.refreshItems(true);
                }
                break;
              default:
                $scope.selectItems = [];
                initialized.resolve($scope.selectItems);
            }
          }
        ],
        settings: {
          input: true,
          tableView: true,
          label: '',
          key: 'selectboxesField',
          data: {
            values: [],
            json: '',
            url: '',
            resource: '',
            custom: ''
          },
          dataSrc: 'values',
          valueProperty: '',
          labelProperty: '',
          refreshOn: '',
          filter: '',
          authenticate: false,
          inline: false,
          protected: false,
          persistent: true,
          hidden: false,
          clearOnHide: true,
          validate: {
            required: false
          }
        }
      });
    }
  ]);

  app.run([
    '$templateCache',
    function($templateCache) {
      $templateCache.put('formio/components/selectboxes-directive.html',
        fs.readFileSync(__dirname + '/../templates/components/selectboxes-directive.html', 'utf8')
      );
      $templateCache.put('formio/components/selectboxes.html',
        fs.readFileSync(__dirname + '/../templates/components/selectboxes.html', 'utf8')
      );
    }
  ]);
};
