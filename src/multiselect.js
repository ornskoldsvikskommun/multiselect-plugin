﻿import Origo from 'Origo';
import buffer from '@turf/buffer';
import disjoint from '@turf/boolean-disjoint';
import * as defaultstyles from './defaultstyles';

const Multiselect = function Multiselect(options = {}) {
  let selectSource;
  let isActive = false;
  let clickInteraction;
  let boxInteraction;
  let circleInteraction;
  let polygonInteraction;
  let bufferInteraction;
  let lineInteraction;
  let sketch;
  let radius;
  let radiusXPosition;
  let radiusYPosition;
  let radiusLengthTooltip;
  let radiusLengthTooltipElement;
  let bufferFeature;
  let temporaryLayer;
  let map;
  let activeButton;
  let defaultButton;
  let type;
  let viewer;
  let multiselectButton;
  let clickSelectionButton;
  let polygonSelectionButton;
  let boxSelectionButton;
  let circleSelectionButton;
  let bufferSelectionButton;
  let lineSelectionButton;
  let configSelectionButton;
  let target;
  let multiselectElement;
  let selectionManager;
  /** name of symbol in origo configuration */
  let bufferSymbol;
  /** name of symbol in origo configuration */
  let chooseSymbol;
  
  const buttons = [];
  const clusterFeatureinfoLevel = 1;
  const hitTolerance = 0;

  const tools = Object.prototype.hasOwnProperty.call(options, 'tools') ? options.tools : ['click', 'box', 'circle', 'polygon', 'buffer', 'line'];
  const defaultTool = Object.prototype.hasOwnProperty.call(options, 'default') ? options.default : 'click';
  const lineBufferFactor = Object.prototype.hasOwnProperty.call(options, 'lineBufferFactor') && options.lineBufferFactor >= 1 ? options.lineBufferFactor : 1;
  const clickSelection = tools.includes('click');
  const boxSelection = tools.includes('box');
  const circleSelection = tools.includes('circle');
  const polygonSelection = tools.includes('polygon');
  const bufferSelection = tools.includes('buffer');
  const lineSelection = tools.includes('line');
  // Add at least one default configuration to make life easier later
  const selectableLayers = options.selectableLayers ? options.selectableLayers : [{ name: 'Default' }];
  let currentLayerConfig = options.defaultLayerConfig ? selectableLayers[options.defaultLayerConfig] : selectableLayers[0];
  const pointBufferFactor = options.pointBufferFactor ? options.pointBufferFactor : 1;

  function setActive(state) {
    isActive = state;
  }

  function toggleMultiselection() {
    const detail = {
      name: 'multiselection',
      active: !isActive
    };
    viewer.dispatch('toggleClickInteraction', detail);
  }

  function enableInteraction() {
    document.getElementById(multiselectButton.getId()).classList.add('active');
    // This accidently unhides the multselect button. But that's OK.
    buttons.forEach(currButton => {
      document.getElementById(currButton.getId()).classList.remove('hidden');
    });
    document.getElementById(multiselectButton.getId()).classList.remove('tooltip');
    setActive(true);
    addInteractions();
    document.getElementById(defaultButton.getId()).click();
    // if features are added to selection managaer from featureinfo, this will clear that selection when activating multiselect.
    // selectionManager.clearSelection();
  }

  function disableInteraction() {
    if (activeButton) {
      document.getElementById(activeButton.getId()).classList.remove('active');
    }
    document.getElementById(multiselectButton.getId()).classList.remove('active');
    buttons.forEach(currButton => {
      if (currButton !== multiselectButton) {
        document.getElementById(currButton.getId()).classList.add('hidden');
      }
    });

    document.getElementById(multiselectButton.getId()).classList.add('tooltip');

    removeInteractions();
    removeRadiusLengthTooltip();
    temporaryLayer.clear();
    selectionManager.clearSelection();
    setActive(false);
  }

  function addInteractions() {
    clickInteraction = new Origo.ol.interaction.Pointer({
      handleEvent: fetchFeatures_Click
    });

    boxInteraction = new Origo.ol.interaction.Draw({
      source: selectSource,
      type: 'Circle',
      geometryFunction: Origo.ol.interaction.Draw.createBox()
    });

    circleInteraction = new Origo.ol.interaction.Draw({
      source: selectSource,
      type: 'Circle'
    });

    polygonInteraction = new Origo.ol.interaction.Draw({
      source: selectSource,
      type: 'Polygon'
    });

    bufferInteraction = new Origo.ol.interaction.Pointer({
      handleEvent: fetchFeatures_Buffer_click
    });

    lineInteraction = new Origo.ol.interaction.Draw({
      source: selectSource,
      type: 'LineString'
    });

    map.addInteraction(clickInteraction);
    map.addInteraction(boxInteraction);
    map.addInteraction(circleInteraction);
    map.addInteraction(polygonInteraction);
    map.addInteraction(bufferInteraction);
    map.addInteraction(lineInteraction);

    boxInteraction.on('drawend', fetchFeatures_Box);
    circleInteraction.on('drawstart', (evt) => {
      sketch = evt.feature.getGeometry();
      createRadiusLengthTooltip();
    });
    circleInteraction.on('drawend', fetchFeatures_Circle);
    polygonInteraction.on('drawend', fetchFeatures_Polygon);
    lineInteraction.on('drawend', fetchFeatures_LineString);
  }

  function toggleType(button) {
    if (activeButton) {
      document.getElementById(activeButton.getId()).classList.remove('active');
    }

    function disableAll() {
      clickInteraction.setActive(false);
      boxInteraction.setActive(false);
      circleInteraction.setActive(false);
      polygonInteraction.setActive(false);
      bufferInteraction.setActive(false);
      lineInteraction.setActive(false);
      map.un('pointermove', pointerMoveHandler);
    }

    document.getElementById(button.getId()).classList.add('active');
    activeButton = button;

    disableAll();

    if (type === 'click') {
      clickInteraction.setActive(true);
    } else if (type === 'box') {
      boxInteraction.setActive(true);
    } else if (type === 'circle') {
      circleInteraction.setActive(true);
      map.on('pointermove', pointerMoveHandler);
    } else if (type === 'polygon') {
      polygonInteraction.setActive(true);
    } else if (type === 'buffer') {
      bufferInteraction.setActive(true);
    } else if (type === 'line') {
      lineInteraction.setActive(true);
    }
  }

  function removeInteractions() {
    map.removeInteraction(clickInteraction);
    map.removeInteraction(boxInteraction);
    map.removeInteraction(circleInteraction);
    map.removeInteraction(polygonInteraction);
    map.removeInteraction(bufferInteraction);
    map.removeInteraction(lineInteraction);
  }

  /**
   * Event handler for click event. Selects features by mouse click, almost like featureInfo
   * @param {any} evt
   */
  function fetchFeatures_Click(evt) {

    if (evt.type === 'singleclick') {
      const isCtrlKeyPressed = evt.originalEvent.ctrlKey;

      if (currentLayerConfig.layers) {
        // If configured with specific layers, we can't use the featureInfo functions to fecth features as they honour visibility
        const resolution = map.getView().getResolution()
        const point = new Origo.ol.geom.Point(evt.coordinate);
        // Buffer the point to make it emulate featureInfo radius.
        const geometry = createBufferedFeature(point, resolution * pointBufferFactor).getGeometry();
        updateSelectionManager(geometry, isCtrlKeyPressed);
      } else {
        // For backwards compability use featureInfo style when not using specific layer conf.
        // The featureInfo style will honour the alternative featureInfo layer and radius configuration in the core
        // also it unwinds clustering.
        // Featureinfo in two steps. Concat serverside and clientside when serverside is finished
        const pixel = evt.pixel;
        const coordinate = evt.coordinate;
        const layers = viewer.getQueryableLayers();
        const clientResult = Origo.getFeatureInfo.getFeaturesAtPixel({
          coordinate,
          map,
          pixel,
          clusterFeatureinfoLevel,
          hitTolerance
        }, viewer);
        // Abort if clientResult is false
        if (clientResult !== false) {
          Origo.getFeatureInfo.getFeaturesFromRemote({
            coordinate,
            layers,
            map,
            pixel
          }, viewer)
            .then((data) => {
              const serverResult = data || [];
              const result = serverResult.concat(clientResult);
              if (isCtrlKeyPressed) {
                if (result.length > 0) {
                  selectionManager.removeItems(result);
                }
              } else if (result.length === 1) {
                selectionManager.addOrHighlightItem(result[0]);
              } else if (result.length > 1) {
                selectionManager.addItems(result);
              }
            });
        }
        return false;
      }
    }
    return true;
  }

  /**
   * Event handler for rectangle interaction. Selects features by a rectangle.
   * @param {any} evt
   */
  function fetchFeatures_Box(evt) {
    const geometry = evt.feature.getGeometry();
    updateSelectionManager(geometry);
  }

  /**
   * Event handler för circle interaction. Selects features by a circle.
   * @param {any} evt
   */
  function fetchFeatures_Circle(evt) {
    // Things needed to be done on 'drawend'
    // ==>
    sketch = null;
    removeRadiusLengthTooltip();
    // <==

    const geometry = evt.feature.getGeometry();
    updateSelectionManager(geometry);
  }

  /**
   * Event handler för polygon interaction. Selects features by a polygon.
   * @param {any} evt
   */
  function fetchFeatures_Polygon(evt) {
    const geometry = evt.feature.getGeometry();
    updateSelectionManager(geometry);
  }

  /**
   * Eventhandler for click when selecting by feature. Selects the feature to select by. If click hits severat features
   * a modal is displayed.
   * @param {any} evt
   */
  function fetchFeatures_Buffer_click(evt) {
    if (evt.type === 'singleclick') {
      // Featurinfo in two steps. Concat serverside and clientside when serverside is finished
      const pixel = evt.pixel;
      const coordinate = evt.coordinate;
      const layers = viewer.getQueryableLayers();
      const clientResult = Origo.getFeatureInfo.getFeaturesAtPixel({
        coordinate,
        map,
        pixel,
        clusterFeatureinfoLevel,
        hitTolerance
      }, viewer);
      // Abort if clientResult is false
      if (clientResult !== false) {
        Origo.getFeatureInfo.getFeaturesFromRemote({
          coordinate,
          layers,
          map,
          pixel
        }, viewer)
          .then((data) => {
            const serverResult = data || [];
            const result = serverResult.concat(clientResult);
            if (result.length > 0) {
              let promise;
              if (result.length === 1) {
                bufferFeature = result[0].getFeature().clone();
                promise = Promise.resolve();
              } else if (result.length > 1) {
                promise = createFeatureSelectionModal(result);
              }
              promise.then(() => createRadiusModal());
            }
          });
      }
      return false;
    }
    return true;
  }
  /**
   * Event handler for line interaction. Selects by line.
   * @param {any} evt
   */
  function fetchFeatures_LineString(evt) {
    const geometry = evt.feature.getGeometry();
    const resolution = map.getView().getResolution()
    // Buffer the line to make it possible to hit points with a line
    const bufferedGeometry = createBufferedFeature(geometry, resolution * lineBufferFactor).getGeometry();
    updateSelectionManager(bufferedGeometry);
  }

  function displayTemporaryFeature(feature, style) {
    const f = feature.clone();

    f.setStyle(style);
    temporaryLayer.addFeature(f);
  }

  /**
   * Displays a modal so the user can select which feature to select by.
   * @param {any} items
   */
  function createFeatureSelectionModal(items) {
    // extracting features
    const features = items.map((item) => item.getFeature());
    const featuresList = items.map((item) => {
      const layerAttributes = item.getLayer().get('attributes');
      const bufferAttribute = layerAttributes ? layerAttributes[0].name ? layerAttributes[0].name : undefined : undefined;
      const layerName = item.getLayer().get('title');
      const feature = item.getFeature();
      const title = feature.get(bufferAttribute) || feature.get('namn') || feature.getId();
      const titleEl = layerName ? `<span><b>${title}</b> (${layerName})</span>` : `<span>${title}</span>`;
      // FIXME: add layername to id (or refactor to not use id at all) to support AGS and same source layers
      return `<div class="featureSelectorItem hover pointer" id="${feature.getId()}"> ${titleEl} </div>`;
    });

    return new Promise((resolve) => {
      const title = 'Du har valt flera objekt:';
      const content = `<div id="featureSelector">
                        ${featuresList.join('')}
                      </div>`;
      const target = viewer.getId();
      const modal = Origo.ui.Modal({
        title,
        content,
        target
      });
      const featureSelectors = document.getElementsByClassName('featureSelectorItem');

      for (let index = 0; index < featureSelectors.length; index++) {
        const f = featureSelectors[index];
        f.addEventListener('click', function (e) {
          bufferFeature = features.find((ff) => ff.getId().toString() === this.id).clone();
          modal.closeModal();
          resolve();
          // Remove highlight here if user happens to close the buffer modal without submitting, as we don't know when that happens
          // In the future core may have an event on Modal when its closed.
          temporaryLayer.clear();
          e.stopPropagation();
        });
        f.addEventListener('mouseover', function() {
          const hoverFeature = features.find((ff) => ff.getId().toString() === this.id).clone();
          displayTemporaryFeature(hoverFeature, chooseSymbol);
         
        });
        f.addEventListener('mouseout', function () {
          temporaryLayer.clear();
        });
      }
    });
  }

  /**
   * Displays a modal so the user can enter a buffer radius
   * */
  function createRadiusModal() {
    const title = 'Ange buffert i meter (ex 10,4):';
    const content = `<div>
                      <form id="radius-form">
                      <input type="number" id="bufferradius">
                      <button type="submit">OK</button>
                    </div></form>`;
    const target = viewer.getId();
    const modal = Origo.ui.Modal({
      title,
      content,
      target
    });
    const formEl = document.getElementById('radius-form');

    const bufferradiusEl = document.getElementById('bufferradius');
    bufferradiusEl.focus();

    formEl.addEventListener('submit', (e) => {
      // Don't want to actually submit form
      e.preventDefault();
      const radiusVal = bufferradiusEl.value;
      // Rely on browser to ensure type="number"
      const radius = parseFloat(radiusVal);

      // Not allowed to buffer inwards for 0 and 1 dimensional geometries
      if ((!radius && radius !== 0)
        || (radius <= 0 && (bufferFeature.getGeometry().getType() === 'Point'
          || bufferFeature.getGeometry().getType() === 'MultiPoint'
          || bufferFeature.getGeometry().getType() === 'MultiLineString'
          || bufferFeature.getGeometry().getType() === 'LineString'))) {
        
        return;
      } 

      modal.closeModal();
      
      fetchFeatures_Buffer_buffer(radius);
    });
  }

  /**
   * Displays a modal so the user can change settings.
   * */
  function showSettingsModal() {
    const title = 'Välj aktiv konfiguration:';
    const dropdownContainerId = 'dropdown-container';
    let content = `<div id="${dropdownContainerId}"></div>`;
    const target = viewer.getId();
    const modal = Origo.ui.Modal({
      title,
      content,
      target
    });

    let activeIndex;
    const selectOptions = selectableLayers.map((currConfig,ix) => {
      const obj = {};
      obj.name = currConfig.name;
      // Have to cast index to string in order for dropdown to make a correct comparison when setting active item
      obj.value = ix.toString();
      // Piggyback on the map loop to find active index.
      if (currConfig === currentLayerConfig) {
        activeIndex = ix.toString();
      }
      return obj;
    });
    // The drop down magically injects itself in the dropdown container
    Origo.dropdown(dropdownContainerId, selectOptions, {
      dataAttribute: 'index',
      active: activeIndex
    });

    // Drop down emits a custom event on the container element when selection is made
    document.getElementById(dropdownContainerId).addEventListener('changeDropdown', (e) => {
      currentLayerConfig = selectableLayers[parseInt(e.detail.dataAttribute)];
       modal.closeModal();
    });
  }

  /**
   * Selects features by an already selected feature (in a global variable) with a buffer.
   * @param {any} radius
   */
  function fetchFeatures_Buffer_buffer(radius) {
    const geometry = bufferFeature.getGeometry();
    const bufferedFeature = createBufferedFeature(geometry, radius);
    displayTemporaryFeature(bufferedFeature, bufferSymbol);

    const bufferedGeometry = bufferedFeature.getGeometry();
    updateSelectionManager(bufferedGeometry);
  }

  // General function that recieves a geometry and a radius and returns a buffered feature
  /**
   * Helper that buffers a geometry. The result is returned as a new feature.
   * @param {any} geometry
   * @param {any} radius
   * @returns A feature
   */
  function createBufferedFeature(geometry, radius) {
    temporaryLayer.clear();
    const format = new Origo.ol.format.GeoJSON();
    const projection = map.getView().getProjection();
    let turfGeometry;
    // Clone first to avoid messing up caller's geometry
    const geometryClone = geometry.clone();

    if (geometryClone.getType() === 'Circle') {
      // circle is not a standard geometry. we need to create a polygon first.
      const polygon = Origo.ol.geom.Polygon.fromCircle(geometryClone);
      polygon.transform(projection, 'EPSG:4326');
      turfGeometry = format.writeGeometryObject(polygon);
    } else {
      geometryClone.transform(projection, 'EPSG:4326');
      turfGeometry = format.writeGeometryObject(geometryClone);
    }

    // OBS! buffer always return a feature
    // Have to transform as turf only works with WGS84. 
    const bufferedTurfFeature = buffer(turfGeometry, radius / 1000, { units: 'kilometers' });
    const bufferedOLFeature = format.readFeature(bufferedTurfFeature);
    bufferedOLFeature.getGeometry().transform('EPSG:4326', projection);

    return bufferedOLFeature;
  }

  /**
   * Determines if a layer should be available for selection
   * @param {any} layer
   */
  function shouldSkipLayer(layer) {
    if (currentLayerConfig.exclude) {
      if (currentLayerConfig.exclude.some(l => layer.get('name') === l)) {
        // Explicitly excluded by config
        return true;
      }
    }
    if (currentLayerConfig.layers) {
      // We're only called if configured. No need to check again
      // This makes all layers in a group layer default in when using layer config
      return false;
    }

    // If we got here it means that no config is present, or current config is just a named default setting (use visible)


    // We need to check manually if layer is in the visible range considering maxResolution and minResolution for a layer.
    // For click we do not need this check because the function "forEachFeatureAtPixel" on the map object takes care of that out of the box.
    // Also we need to check if the layer is "queryable". The reason is that if the layer is a normal layer, this check is already done, but if it is sublayer of a group then the check is needed here.

    if (!layer.get('queryable')) {
      return true;
    }

    const resolution = map.getView().getResolution();
    if (resolution > layer.getMaxResolution() || resolution < layer.getMinResolution()) {
      return true;
    }

    return false;
  }


  /**
   * Helper that does returns all features as an array of SelectedItem that has an extent that intersects the given extent from the given layer
   * @param {any} layer
   * @param {any} groupLayer
   * @param {any} extent
   */
  async function extractResultsForALayer(layer, groupLayer, extent) {
    let selectionGroup;
    let selectionGroupTitle;
    let selectedItems = [];

    if (groupLayer) {
      selectionGroup = groupLayer.get('name');
      selectionGroupTitle = groupLayer.get('title');
    } else {
      selectionGroup = layer.get('name');
      selectionGroupTitle = layer.get('title');
    }

    // check if layer supports this method, or basically is some sort of vector layer.
    // Alternatively we can check layer.getType() === 'VECTOR', but a bit unsure if all types of vector layer have 'VECTOR' as type.
    // Basically here we get all vector features from client.
    if (layer.getSource().forEachFeatureIntersectingExtent) {
      if (currentLayerConfig.layers && layer.get('type') === 'WFS' && layer.get('strategy') !== 'all') {
        // If Wfs is using bbox, the features may not have beeen fetched if layer is not visisble
        // FIXME: getFeature does not honour coordinate systems and it is no use to translate the extent, as getFeature 
        // compares the extent with extent in map SRS, so it will likely be out of bounds.
        // Best solution would be to implement WfsSource exposing methods for fore load. Second best, update getFeature.
        const serverFeatures = await Origo.getFeature(null, layer, viewer.getMapSource(), viewer.getProjectionCode(), viewer.getProjection(), extent);
        layer.getSource().addFeatures(serverFeatures);
      }
      layer.getSource().forEachFeatureIntersectingExtent(extent, (feature) => {
        // If clustered features should be supported they should be unwrapped here first.
        const item = new Origo.SelectedItem(feature, layer, map, selectionGroup, selectionGroupTitle);
        selectedItems.push(item);
      });
    } else {
      // FIXME: call conditionally if configured to do so, or fix inside function to always succeed.
      const remoteItems = await getFeaturesFromWfsServer(layer, extent, selectionGroup, selectionGroupTitle);
      // Can't have both local and remote in same layer, so this is safe.
      selectedItems = remoteItems;
    }
    return selectedItems;
  }

  /**
   * Gets all features from the eligable layers intersecting the geometry and adds (or remove) them to SelectionManager. 
   * @param {any} geometry The geometry to intersect
   * @param {any} remove true if selection should be removed insread of added
   */
  async function updateSelectionManager(geometry, remove) {
    const promises = [];
    let layers;
    const extent = geometry.getExtent();

    /**
     * Recursively traverse all layers to discover all individual layers in group layers 
     * @param {any} layers
     * @param {any} groupLayer
     */
    function traverseLayers(layers, groupLayer) {
      for (let i = 0; i < layers.length; i += 1) {
        const currLayer = layers[i];
        if (!shouldSkipLayer(currLayer)) {
          if (currLayer.get('type') === 'GROUP') {
            const subLayers = currLayer.getLayers().getArray();
            traverseLayers(subLayers, currLayer);
          } else {
            promises.push(extractResultsForALayer(currLayer, groupLayer, extent));
          }
        }
      }
    }

    if (currentLayerConfig.layers) {
      // Use configured layers
      layers = currentLayerConfig.layers.map(l => viewer.getLayer(l));
    } else {
      // Use queryable layers when no config exists (default behaviour)
      layers = viewer.getQueryableLayers();
    }

    // This call populates the promises array, so on the next line we can await it
    traverseLayers(layers);
    const items = await Promise.all(promises);
    // Is an array of arrays, we want an array.
    const allItems = items.flat();

    // Narrow down selection to only contain thos whose actual geometry intersects the selection geometry.
    // We could implement different spatial relations, i.e contains, is contained etc. But for now only intersect is supported.
    const intersectingItems = getItemsIntersectingGeometry(allItems, geometry);

    // Add them to selection
    // handle removal for point when ctrl-click
    if (remove) {
      if (intersectingItems.length > 0) {
        selectionManager.removeItems(intersectingItems);
      }
    } else if (intersectingItems.length === 1) {
      selectionManager.addOrHighlightItem(intersectingItems[0]);
    } else if (intersectingItems.length > 1) {
      selectionManager.addItems(intersectingItems);
    }
  }

  /**
   * General function that returns all features intersecting a geometry
   * @param {any} items
   * @param {any} _geometry
   */
  function getItemsIntersectingGeometry(items, _geometry) {
    const geometry = _geometry.clone();

    const format = new Origo.ol.format.GeoJSON();
    const projection = map.getView().getProjection();
    let turfGeometry;

    if (geometry.getType() === 'Circle') {
      // circle is not a standard geometry. we need to create a polygon first.
      const polygon = Origo.ol.geom.Polygon.fromCircle(geometry);
      polygon.transform(projection, 'EPSG:4326');
      turfGeometry = format.writeGeometryObject(polygon);
    } else {
      geometry.transform(projection, 'EPSG:4326');
      turfGeometry = format.writeGeometryObject(geometry);
    }

    const intersectingItems = [];
    items.forEach((item) => {
      // Clone first to avoid messing with the original feature as transform do an in place transformation
      const feature = item.getFeature().clone();
      feature.getGeometry().transform(projection, 'EPSG:4326');
      const turfFeature = format.writeFeatureObject(feature);
      const booleanDisjoint = disjoint(turfFeature, turfGeometry);

      if (!booleanDisjoint) {
        intersectingItems.push(item);
      }

    });

    return intersectingItems;
  }

  // FIXME: rewrite and use layer's featureInfo layer instead? This is dangerous and expects all non-feature layers to have a wfs backing it up.
  // Alternatively add a setting if this should be tried
  function getFeaturesFromWfsServer(layer, extent, selectionGroup, selectionGroupTitle) {
    return new Promise(((resolve) => {
      // FIXME: getFeature ignores SRS. Won't work if different SRS
      // Will be fixed in origo.
      const req = Origo.getFeature(null, layer, viewer.getMapSource(), viewer.getProjectionCode(), viewer.getProjection(), extent);
      req.then((data) => {
        const selectedRemoteItems = data.map((feature) => new Origo.SelectedItem(feature, layer, map, selectionGroup, selectionGroupTitle));
        resolve(selectedRemoteItems);
      })
        .catch((err) => { console.error(err); });
    }));
  }

  /**
   * Displays the circe radius when selecting by circle.
   * */
  function createRadiusLengthTooltip() {
    if (radiusLengthTooltipElement) {
      radiusLengthTooltipElement.parentNode.removeChild(radiusLengthTooltipElement);
    }

    radiusLengthTooltipElement = document.createElement('div');
    radiusLengthTooltipElement.className = 'o-tooltip o-tooltip-measure';

    radiusLengthTooltip = new Origo.ol.Overlay({
      element: radiusLengthTooltipElement,
      offset: [0, 0],
      positioning: 'bottom-center',
      stopEvent: false
    });

    map.addOverlay(radiusLengthTooltip);
  }

  function removeRadiusLengthTooltip() {
    map.removeOverlay(radiusLengthTooltip);
  }

  /**
   * Event handler that updates the radius when slecting by circle
   * @param {any} e
   */
  function pointerMoveHandler(e) {
    if (!sketch) return;

    radius = sketch.getRadius();
    radiusLengthTooltipElement.innerHTML = `${radius.toFixed()} m`;
    radiusXPosition = (e.coordinate[0] + sketch.getCenter()[0]) / 2;
    radiusYPosition = (e.coordinate[1] + sketch.getCenter()[1]) / 2;
    radiusLengthTooltip.setPosition([radiusXPosition, radiusYPosition]);
  }

  return Origo.ui.Component({
    name: 'multiselection',
    onInit() {
      if (clickSelection || boxSelection || circleSelection || polygonSelection || bufferSelection) {
        multiselectElement = Origo.ui.Element({
          tagName: 'div',
          cls: 'flex column'
        });

        multiselectButton = Origo.ui.Button({
          cls: 'o-multiselect padding-small margin-bottom-smaller icon-smaller round light box-shadow',
          click() {
            toggleMultiselection();
          },
          icon: '#baseline-select-all-24px',
          tooltipText: 'Markera i kartan',
          tooltipPlacement: 'east'
        });
        buttons.push(multiselectButton);

        if (clickSelection) {
          clickSelectionButton = Origo.ui.Button({
            cls: 'o-multiselect-click padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              type = 'click';
              toggleType(this);
            },
            icon: '#fa-mouse-pointer',
            tooltipText: 'Klick',
            tooltipPlacement: 'east'
          });
          buttons.push(clickSelectionButton);
          defaultButton = clickSelectionButton;
        }

        if (boxSelection) {
          boxSelectionButton = Origo.ui.Button({
            // o-home-in padding-small icon-smaller round light box-shadow o-tooltip
            cls: 'o-multiselect-box padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              type = 'box';
              toggleType(this);
            },
            // icon: '#baseline-crop_square-24px',
            icon: '#fa-square-o',
            tooltipText: 'Ruta',
            tooltipPlacement: 'east'
          });
          buttons.push(boxSelectionButton);
        }

        if (circleSelection) {
          circleSelectionButton = Origo.ui.Button({
            cls: 'o-multiselect-circle padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              type = 'circle';
              toggleType(this);
            },
            icon: '#fa-circle-o',
            tooltipText: 'Cirkel',
            tooltipPlacement: 'east'
          });
          buttons.push(circleSelectionButton);
        }

        if (polygonSelection) {
          polygonSelectionButton = Origo.ui.Button({
            cls: 'o-multiselect-polygon padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              type = 'polygon';
              toggleType(this);
            },
            icon: '#fa-draw-polygon-o',
            tooltipText: 'Polygon',
            tooltipPlacement: 'east'
          });
          buttons.push(polygonSelectionButton);
        }

        if (bufferSelection) {
          bufferSelectionButton = Origo.ui.Button({
            cls: 'o-multiselect-buffer padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              type = 'buffer';
              toggleType(this);
            },
            icon: '#fa-bullseye',
            tooltipText: 'Buffer',
            tooltipPlacement: 'east'
          });
          buttons.push(bufferSelectionButton);
        }

        if (lineSelection) {
          lineSelectionButton = Origo.ui.Button({
            cls: 'o-multiselect-line padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              type = 'line';
              toggleType(this);
            },
            icon: '#fa-minus',
            tooltipText: 'Linje',
            tooltipPlacement: 'east'
          });
          buttons.push(lineSelectionButton);
        }

        if (selectableLayers.length > 1) {
          configSelectionButton = Origo.ui.Button({
            cls: 'o-multiselect-config padding-small margin-bottom-smaller icon-smaller round light box-shadow hidden',
            click() {
              showSettingsModal();
            },
            icon: '#ic_tune_24px',
            tooltipText: 'Inställningar',
            tooltipPlacement: 'east'
          });
          buttons.push(configSelectionButton);
        }


        if (defaultTool === 'click') {
          defaultButton = clickSelectionButton;
        } else if (defaultTool === 'box') {
          defaultButton = boxSelectionButton;
        } else if (defaultTool === 'circle') {
          defaultButton = circleSelectionButton;
        } else if (defaultTool === 'polygon') {
          defaultButton = polygonSelectionButton;
        } else if (defaultTool === 'buffer') {
          defaultButton = bufferSelectionButton;
        } else if (defaultTool === 'line') {
          defaultButton = lineSelectionButton;
        }
      }
    },
    onAdd(evt) {
      viewer = evt.target;
      target = `${viewer.getMain().getMapTools().getId()}`;
      map = viewer.getMap();
      selectionManager = viewer.getSelectionManager();
      // source object to hold drawn features that mark an area to select features fromstyle
      // Draw Interaction does not need a layer, only a source is enough for it to work.
      selectSource = new Origo.ol.source.Vector();

      // Use default symbols or symbols from configuration 
      bufferSymbol = options.bufferSymbol ? Origo.Style.createStyle({ style: options.bufferSymbol, viewer })() : Origo.Style.createStyleRule(defaultstyles.buffer);
      chooseSymbol = options.chooseSymbol ? Origo.Style.createStyle({ style: options.chooseSymbol, viewer })() : Origo.Style.createStyleRule(defaultstyles.choose);

      temporaryLayer = Origo.featurelayer(null, map);

      this.addComponents(buttons);
      this.render();

      viewer.on('toggleClickInteraction', (detail) => {
        if (detail.name === 'multiselection' && detail.active) {
          enableInteraction();
        } else {
          disableInteraction();
        }
      });
    },
    render() {
      let htmlString = `${multiselectElement.render()}`;
      const dom = Origo.ui.dom;
      let el = dom.html(htmlString);
      document.getElementById(target).appendChild(el);

      buttons.forEach(currButton => {
        htmlString = currButton.render();
        el = dom.html(htmlString);
        document.getElementById(multiselectElement.getId()).appendChild(el);
      });

      this.dispatch('render');
    }
  });
};

export default Multiselect;