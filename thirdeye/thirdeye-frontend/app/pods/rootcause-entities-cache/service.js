import Ember from 'ember';
import { checkStatus, filterObject, filterPrefix, toBaselineRange, stripTail } from 'thirdeye-frontend/helpers/utils';
import fetch from 'fetch';
import _ from 'lodash';

export default Ember.Service.extend({
  entities: null, // {}

  context: null, // {}

  nativeUrns: null, // Set

  pending: null, // Set

  init() {
    this._super(...arguments);
    this.setProperties({ entities: {}, context: {}, pending: new Set(), nativeUrns: new Set() });
  },

  request(requestContext, urns) {
    const { context, entities, nativeUrns } = this.getProperties('context', 'entities', 'nativeUrns');

    // special case: urn identity
    const requestNativeUrns = new Set(filterPrefix(urns, 'thirdeye:metric:'));
    if (!_.isEqual(nativeUrns, requestNativeUrns)) {
      this.setProperties({ nativeUrns: requestNativeUrns });

      const missingSelectedEntities = [...requestNativeUrns].filter(urn => !entities[urn]);
      if (missingSelectedEntities) {
        fetch(this._makeIdentityUrl(requestNativeUrns))
          .then(checkStatus)
          .then(this._jsonToEntities)
          .then(incoming => this._complete(requestContext, urns, incoming, 'identity'));
      }
    }

    // rootcause search
    if (!_.isEqual(context, requestContext)) {
      if (!requestContext.urns || !requestContext.urns.size) {
        const newEntities = filterObject(entities, (e) => urns.has(e.urn));
        this.setProperties({ context: _.cloneDeep(requestContext), entities: newEntities });
        return;
      }

      const frameworks = new Set(['relatedEvents', 'relatedDimensions', 'relatedMetrics']);

      this.setProperties({ context: _.cloneDeep(requestContext), pending: frameworks });

      frameworks.forEach(framework => {
        fetch(this._makeUrl(framework, requestContext))
          .then(checkStatus)
          .then(this._jsonToEntities)
          .then(incoming => this._complete(requestContext, urns, incoming, framework));
      });
    }
  },

  _complete(requestContext, pinnedUrns, incoming, framework) {
    // only accept latest result
    const { context } = this.getProperties('context');
    if (!_.isEqual(context, requestContext)) {
      // console.log('rootcauseEntitiesCache: _complete: received stale result. ignoring.');
      return;
    }

    const pinnedBaseUrns = new Set([...pinnedUrns].map(stripTail));

    // evict unselected
    const { entities, pending } = this.getProperties('entities', 'pending');
    const stale = new Set(this._evictionCandidates(entities, framework).map(stripTail));
    const staleSelected = new Set([...stale].filter(urn => pinnedBaseUrns.has(urn)));
    const staleUnselected = new Set([...stale].filter(urn => !pinnedBaseUrns.has(urn)));

    // rebuild remaining cache
    const remaining = {};
    Object.keys(entities).filter(urn => !staleUnselected.has(urn)).forEach(urn => remaining[urn] = entities[urn]);
    Object.keys(entities).filter(urn => staleSelected.has(urn)).forEach(urn => remaining[urn].score = -1);

    // merge
    const newEntities = Object.assign({}, remaining, incoming);

    // update pending
    const newPending = new Set(pending);
    newPending.delete(framework);

    this.setProperties({ entities: newEntities, pending: newPending });
  },

  _evictionCandidates(entities, framework) {
    switch (framework) {
      case 'relatedEvents':
        return filterPrefix(Object.keys(entities), 'thirdeye:event:');
      case 'relatedDimensions':
        return filterPrefix(Object.keys(entities), 'thirdeye:dimension:');
      case 'relatedMetrics':
        return filterPrefix(Object.keys(entities), 'thirdeye:metric:');
      case 'identity':
        return [];
      default:
        return [];
    }
  },

  _makeUrl(framework, context) {
    const baseUrns = filterPrefix(context.urns, ['thirdeye:metric:', 'thirdeye:dimension:']).map(stripTail);
    const urnString = baseUrns.join(',');
    const baselineRange = toBaselineRange(context.anomalyRange, context.compareMode);
    return `/rootcause/query?framework=${framework}` +
      `&anomalyStart=${context.anomalyRange[0]}&anomalyEnd=${context.anomalyRange[1]}` +
      `&baselineStart=${baselineRange[0]}&baselineEnd=${baselineRange[1]}` +
      `&analysisStart=${context.analysisRange[0]}&analysisEnd=${context.analysisRange[1]}` +
      `&urns=${urnString}`;
  },

  _makeIdentityUrl(urns) {
    const baseUrns = [...urns].map(stripTail);
    const urnString = baseUrns.join(',');
    return `/rootcause/raw?framework=identity&urns=${urnString}`;
  },

  _jsonToEntities(res) {
    if (_.isEmpty(res)) {
      return {};
    }
    return res.reduce((agg, e) => { agg[e.urn] = e; return agg; }, {});
  }
});
