import Ember from 'ember';
import { filterObject, filterPrefix, toBaselineUrn, toCurrentUrn, toColor } from 'thirdeye-frontend/helpers/utils';
import EVENT_TABLE_COLUMNS from 'thirdeye-frontend/mocks/eventTableColumns';
import config from 'thirdeye-frontend/mocks/filterBarConfig';
import CryptoJS from 'cryptojs';
import _ from 'lodash';

const ROOTCAUSE_TAB_DIMENSIONS = "dimensions";
const ROOTCAUSE_TAB_METRICS = "metrics";
const ROOTCAUSE_TAB_EVENTS = "events";

export default Ember.Controller.extend({
  queryParams: [
    'metricId',
    'anomalyId',
    'shareId'
  ],

  //
  // services
  //
  entitiesService: Ember.inject.service('rootcause-entities-cache'),

  timeseriesService: Ember.inject.service('rootcause-timeseries-cache'),

  aggregatesService: Ember.inject.service('rootcause-aggregates-cache'),

  breakdownsService: Ember.inject.service('rootcause-breakdowns-cache'),

  //
  // rootcause search context
  //
  context: null, // { urns: Set, anomalyRange: [2], baselineRange: [2], analysisRange: [2] }

  //
  // user selection
  //
  selectedUrns: null, // Set

  invisibleUrns: null, // Set

  hoverUrns: null, // Set

  filteredUrns: null,

  activeTab: null, // ""

  lastShare: null, // ""

  //
  // static component config
  //
  filterConfig: config, // {}

  settingsConfig: null, // {}

  init() {
    this._super(...arguments);
    this.setProperties({
      invisibleUrns: new Set(),
      hoverUrns: new Set(),
      filteredUrns: new Set(),
      activeTab: ROOTCAUSE_TAB_DIMENSIONS
    });
  },

  _contextObserver: Ember.observer(
    'context',
    'entities',
    'selectedUrns',
    'entitiesService',
    'timeseriesService',
    'aggregatesService',
    'breakdownsService',
    function () {
      const { context, entities, selectedUrns, entitiesService, timeseriesService, aggregatesService, breakdownsService } =
        this.getProperties('context', 'entities', 'selectedUrns', 'entitiesService', 'timeseriesService', 'aggregatesService', 'breakdownsService');

      if (!context || !selectedUrns) {
        return;
      }

      entitiesService.request(context, selectedUrns);
      timeseriesService.request(context, selectedUrns);
      breakdownsService.request(context, selectedUrns);

      const metricUrns = new Set(filterPrefix(Object.keys(entities), 'thirdeye:metric:'));
      const currentUrns = [...metricUrns].map(toCurrentUrn);
      const baselineUrns = [...metricUrns].map(toBaselineUrn);
      aggregatesService.request(context, new Set(currentUrns.concat(baselineUrns)));
    }
  ),

  //
  // Public properties (computed)
  //

  entities: Ember.computed(
    'entitiesService.entities',
    function () {
      const entities = _.cloneDeep(this.get('entitiesService.entities'));

      Object.keys(entities).forEach(urn => entities[urn].color = toColor(urn));

      return entities;
    }
  ),

  timeseries: Ember.computed(
    'timeseriesService.timeseries',
    function () {
      return this.get('timeseriesService.timeseries');
    }
  ),

  aggregates: Ember.computed(
    'aggregatesService.aggregates',
    function () {
      return this.get('aggregatesService.aggregates');
    }
  ),

  breakdowns: Ember.computed(
    'breakdownsService.breakdowns',
    function () {
      return this.get('breakdownsService.breakdowns');
    }
  ),

  anomalyUrn: Ember.computed(
    'context',
    function () {
      const { context } = this.getProperties('context');
      const anomalyUrns = filterPrefix(context.urns, 'thirdeye:event:anomaly:');

      if (!anomalyUrns) { return false; }

      return anomalyUrns[0];
    }
  ),

  chartSelectedUrns: Ember.computed(
    'entities',
    'selectedUrns',
    'invisibleUrns',
    function () {
      const { selectedUrns, invisibleUrns } =
        this.getProperties('selectedUrns', 'invisibleUrns');

      const urns = new Set(selectedUrns);
      [...invisibleUrns].forEach(urn => urns.delete(urn));

      return urns;
    }
  ),

  eventTableEntities: Ember.computed(
    'entities',
    'filteredUrns',
    function () {
      const { entities, filteredUrns } = this.getProperties('entities', 'filteredUrns');
      return filterObject(entities, (e) => filteredUrns.has(e.urn));
    }
  ),

  eventTableColumns: EVENT_TABLE_COLUMNS,

  eventFilterEntities: Ember.computed(
    'entities',
    function () {
      const { entities } = this.getProperties('entities');
      return filterObject(entities, (e) => e.type == 'event');
    }
  ),

  tooltipEntities: Ember.computed(
    'entities',
    'invisibleUrns',
    'hoverUrns',
    function () {
      const { entities, invisibleUrns, hoverUrns } = this.getProperties('entities', 'invisibleUrns', 'hoverUrns');
      const visibleUrns = [...hoverUrns].filter(urn => !invisibleUrns.has(urn));
      return filterObject(entities, (e) => visibleUrns.has(e.urn));
    }
  ),

  isLoadingEntities: Ember.computed(
    'entitiesService.pending',
    function () {
      return this.get('entitiesService.pending').size > 0;
    }
  ),

  isLoadingTimeseries: Ember.computed(
    'timeseriesService.pending',
    function () {
      return this.get('timeseriesService.pending').size > 0;
    }
  ),

  isLoadingAggregates: Ember.computed(
    'aggregatesService.pending',
    function () {
      return this.get('aggregatesService.pending').size > 0;
    }
  ),

  isLoadingBreakdowns: Ember.computed(
    'breakdownsService.pending',
    function () {
      return this.get('breakdownsService.pending').size > 0;
    }
  ),

  //
  // Actions
  //

  actions: {
    onSelection(updates) {
      const { selectedUrns } = this.getProperties('selectedUrns');
      Object.keys(updates).filter(urn => updates[urn]).forEach(urn => selectedUrns.add(urn));
      Object.keys(updates).filter(urn => !updates[urn]).forEach(urn => selectedUrns.delete(urn));
      this.set('selectedUrns', new Set(selectedUrns));
    },

    onVisibility(updates) {
      const { invisibleUrns } = this.getProperties('invisibleUrns');
      Object.keys(updates).filter(urn => updates[urn]).forEach(urn => invisibleUrns.delete(urn));
      Object.keys(updates).filter(urn => !updates[urn]).forEach(urn => invisibleUrns.add(urn));
      this.set('invisibleUrns', new Set(invisibleUrns));
    },

    /**
     * Handles the rootcause_setting change event
     * and updates query params and context
     * @param {Object} newParams new parameters to update
     */
    onContext(context) {
      this.set('context', context);
    },

    onFilter(urns) {
      this.set('filteredUrns', new Set(urns));
    },

    chartOnHover(urns, timestamp) {
      console.log('chartOnHover(): urns timestamp', urns, timestamp);
      this.setProperties({ hoverUrns: new Set(urns), hoverTimestamp: timestamp });
    },

    loadtestSelectedUrns() {
      const { entities } = this.getProperties('entities');

      const entityUrns = Object.keys(entities);
      const metricUrns = filterPrefix(entityUrns, 'thirdeye:metric:');
      const baselineUrns = metricUrns.map(toBaselineUrn);
      const currentUrns = metricUrns.map(toCurrentUrn);

      this.set('selectedUrns', new Set([...entityUrns, ...baselineUrns, ...currentUrns]));
    },

    onShare() {
      const { context, selectedUrns } =
        this.getProperties('context', 'selectedUrns');

      const version = 1;
      const jsonString = JSON.stringify({ selectedUrns, context, version });

      const id = CryptoJS.SHA256(jsonString).toString().substring(0, 16);

      return fetch(`/config/rootcause-share/${id}`, { method: 'POST', body: jsonString })
        .then(res => this.set('shareId', id));
    }
  }
});

