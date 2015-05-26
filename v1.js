// 1.0 Hue API
// Currently the Hue integration is intended to be an application. The client is built using Knockout to bind to PureWeb Application State directly.
// INT wants to have some sort of JavaScript API to control a PureWeb enabled instance of the HueSpace SDK.
// There is insufficient time to development something from scratch, so this attempts to provide a hybrid
//   - Leverage existing JS client code
//   - Provide some sort of programmatic API


var hue = (function (Q, pureweb) {
	
	var connected = false;
	var view = null;
	
	// Simple non-recursive merge for property lists 
	function merge(obj1, obj2) {
		for (var attrname in obj2) { obj1[attrname] = obj2[attrname]; }
		return obj1;
	}
	
	function queueUpdate(path, value) {
		var defer = Q.defer();
	    pureweb.getClient().queueCommand("UpdateValue", { Value: value, Target: path }, function(){
			defer.resolve(value);
		});    	
		return defer.promise;		
	}
	
	// Only allow the highest browser levels to work
	// - WebGL
	// - WebSockets
	// - Typed Arrays 
	function isCompatible() {
		return WebSocket && Uint8Array && webgl_support();
	};

	function webgl_support() {
		try {
			var canvas = document.createElement('canvas');
			return !!window.WebGLRenderingContext && (
				canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
		} catch (e) { return false; }
	};
	
	function ready() {
		var deferred = Q.defer();
		
		if(pureweb.getFramework().getState().isInitialized()) {
			deferred.resolve();
		} else {
			pureweb.listen(pureweb.getFramework(), pureweb.client.Framework.EventType.IS_STATE_INITIALIZED, function(){
				deferred.resolve();
			});
		}
		
		var ctx = this;
		var sessionChanged = function() {
			var sessionState = pureweb.getClient().getSessionState();
		    if (sessionState === pureweb.client.SessionState.FAILED) {
		        if (ctx.error) 
					ctx.error("Communication failure. Restart service");
		    }
		};
		
		pureweb.listen(pureweb.getClient(), pureweb.client.WebClient.EventType.SESSION_STATE_CHANGED, sessionChanged);
		return deferred.promise;
	}
	
	// Request a new HueSpace instance
	function createSession(url, credentials, timeout) {
		if (connected)
			throw "Already connected"
			
		if (!isCompatible())
			throw "Not supported"

		var deferred = Q.defer();
    	
		var connectedChanged = function(e){
			if (e.target.isConnected()) {		
				connected = true;
							
				deferred.resolve(pureweb.getClient().sessionId_);	
    		} else {
				deferred.reject("Failed to connect: " + pureweb.getClient().acquireException);
			}		
		};
		
		pureweb.listen(pureweb.getClient(), pureweb.client.WebClient.EventType.CONNECTED_CHANGED, connectedChanged);
		
		if (this.stalled)
			pureweb.listen(pureweb.getClient(), pureweb.client.WebClient.EventType.STALLED_CHANGED, this.stalled);
		pureweb.getClient().connect(url, credentials);
		
		return deferred.promise.timeout(timeout);
	};
	
	function close() {
		if (!connected)
			return;
			
		pureweb.getClient().disconnect();
		connected = false;
	}

	// Join an existing HueSpace instance through a collaboration URL
	function joinSession(url) {
		throw "Not implemented"
	};
	
	// Uses the target DIVElement Id as a rendered view
	function attachView(id) {
		var deferred = Q.defer();
		
		view = new pureweb.client.View({id: id, viewName: 'MainView'});
		
		var viewUpdatedInternal = function(){
			pureweb.unlisten(view, pureweb.client.View.EventType.VIEW_UPDATED, viewUpdatedInternal);
			deferred.resolve(view);
		};
		
		pureweb.listen(view, pureweb.client.View.EventType.VIEW_UPDATED, viewUpdatedInternal);
		
		if (this.viewUpdated)
				pureweb.listen(view, pureweb.client.View.EventType.VIEW_UPDATED, this.viewUpdated);			
			
		return deferred.promise;
	};
	
	
	
	function detachView(id) {
		view.setViewName(null);
		view = null;
	};

	var settings = {
		probeAlpha: 1.0,
		edgeStrength: 0.3,
		ssaoStrength: 0.5,
		wireframeHorizon: false,
		discreteVoxels: false,
		coverageArea: true,
		horizonThreshold: 0.15
	};

	function updateSettings(s) {
		if (s === null || s === undefined) return settings;
		
		var deferred = Q.defer();
		var promises = [];
		var max = 0;
		
		if (s.hasOwnProperty('probeAlpha')) {
			max = pureweb.util.tryParse(pureweb.getFramework().getState().getStateManager().getValue("/ProbeAlphaMax"), Number);
			promises.push(queueUpdate('ProbeAlpha', s['probeAlpha'] * max)); 
		}

		if (s.hasOwnProperty('edgeStrength')) {
			max = pureweb.util.tryParse(pureweb.getFramework().getState().getStateManager().getValue("/EdgeStrengthMax"), Number);
			promises.push(queueUpdate('EdgeStrength', s['edgeStrength'] * max)); 
		}

		if (s.hasOwnProperty('ssaoStrength')) {
			max = pureweb.util.tryParse(pureweb.getFramework().getState().getStateManager().getValue("/SSAOStrengthMax"), Number);
			promises.push(queueUpdate('SSAOStrength', s['edgeStrength'] * max));
		}

		if (s.hasOwnProperty('wireframeHorizon')) {
			promises.push(queueUpdate('WireframeHorizon', s['wireframeHorizon']));
		}

		if (s.hasOwnProperty('discreteVoxels')) {
			promises.push(queueUpdate('DiscreteVoxels', s['discreteVoxels']));
		}

		if (s.hasOwnProperty('coverageArea')) {
			promises.push(queueUpdate('CoverageArea', s['coverageArea']));
		}

		if (s.hasOwnProperty('horizonThreshold')) {
			max = pureweb.util.tryParse(pureweb.getFramework().getState().getStateManager().getValue("/HorizonThresholdMax"), Number);
			promises.push(queueUpdate('HorizonThreshold', s['horizonThreshold'] * max));
		}

		Q.all(promises).then(function(){
			settings = merge(settings, s);
			deferred.resolve(settings);
		});

		return deferred.promise;
	}
	
	/// Volumes
	var volumes = {
		northBrowsePhase1: true,
		northBrowsePhase2: false,
		northBrowsePhase3: false,
		northBrowsePhase4: false,
		northBrowseMerged: false,
		onnia2: false,
		onniaNorth: false,
		onnia2x3D: false,
		onniaMerged: false
	};

	function updateVolumes(objects) {
		if (objects === null || objects === undefined) return volumes;
		
		var deferred = Q.defer();
		var promises = [];
		
		if (objects.hasOwnProperty('northBrowsePhase1')) {
						
			promises.push(queueUpdate('NorthPhase1', objects['northBrowsePhase1'])); 	
		}

		if (objects.hasOwnProperty('northBrowsePhase2')) {
			promises.push(queueUpdate('NorthPhase2', objects['northBrowsePhase2']));
		}

		if (objects.hasOwnProperty('northBrowsePhase3')) {
			promises.push(queueUpdate('NorthPhase3', objects['northBrowsePhase3']));
		}

		if (objects.hasOwnProperty('northBrowsePhase4')) {
			promises.push(queueUpdate('NorthPhase4', objects['northBrowsePhase4']));
		}

		if (objects.hasOwnProperty('northBrowseMerged')) {
			promises.push(queueUpdate('NorthPhaseMerged', objects['northBrowsePhaseMerged']));
		}

		if (objects.hasOwnProperty('onnia2')) {
			promises.push(queueUpdate('OnniaNorth', objects['onnia2']));
		}

		if (objects.hasOwnProperty('onniaNorth')) {
			promises.push(queueUpdate('OnniaNorth2', objects['onniaNorth']));
		}

		if (objects.hasOwnProperty('onnia2x3D')) {
			promises.push(queueUpdate('OnniaNorth2x', objects['onnia2x3D']));
		}

		if (objects.hasOwnProperty('onniaMerged')) {
			promises.push(queueUpdate('OnniaNorthMerge', objects['onniaMerged']));
		}
		
		Q.all(promises).then(function(){
			volumes = merge(volumes, objects);
			deferred.resolve(volumes);	
		});

		return deferred.promise;
	}
	
	
	/// Probe Mode
	var probeMode = {
		standard: true,
		horizon: false,
		thickness: 28,
		displacement: 0
	};

	function updateProbeMode(mode) {
		if (mode === null || mode === undefined) return probeMode;
		
		var deferred = Q.defer();
		var promises = [];
		
		if (mode.hasOwnProperty('standard')) {
			promises.push(queueUpdate('Horizon', false));
		}		
		if (mode.hasOwnProperty('horizon')) {
			promises.push(queueUpdate('Horizon', true));
		}
		if (mode.hasOwnProperty('thickness')) {
			promises.push(queueUpdate('Thickness', mode['thickness']));
		}
		if (mode.hasOwnProperty('displacement')) {
			promises.push(queueUpdate('Displacement', mode['displacement']));
		}
		
		if (mode['standard'] && mode['horizon'])
			deferred.reject("Cannot set probe mode to both standard and horzion");
		
		Q.all(promises).then(function(){
			probeMode = merge(probeMode, mode);
			deferred.resolve(probeMode);
		});		

		return deferred.promise;
	};
	
	
	/// Display Objects
	var displayObjects = {
		probe: false,
		inline: true,
		crossline: true,
		timeSlice: false,
		arbitrarySection: false,
		horizon: false,
		wells: false
	};

	function updateDisplayObjects(objects) {
		
		if (objects === null || objects === undefined) return displayObjects;
		
		var deferred = Q.defer();
		var promises = [];
		
		if (objects.hasOwnProperty('probe')) {
			promises.push(queueUpdate('Probe', objects['probe']));
		}

		if (objects.hasOwnProperty('inline')) {
			promises.push(queueUpdate('Inline', objects['inline']));
		}

		if (objects.hasOwnProperty('crossline')) {
			promises.push(queueUpdate('Crossline', objects['crossline']));
		}

		if (objects.hasOwnProperty('timeSlice')) {
			promises.push(queueUpdate('TimeSlice', objects['timeSlice']));
		}

		if (objects.hasOwnProperty('arbitrarySection')) {
			promises.push(queueUpdate('ArbitrarySection', objects['arbitrarySection']));
		}
		
		if (objects.hasOwnProperty('horizon')) {
			promises.push(queueUpdate('Horizon', objects['horizon']));
		}

		if (objects.hasOwnProperty('wells')) {
			promises.push(queueUpdate('Wells', objects['wells']));
		}
		
		Q.all(promises).then(function(){
			displayObjects = merge(displayObjects, objects);
			deferred.resolve(displayObjects);
		});

		return deferred.promise;
	};
	
	
	/// Transforms
	var transforms = {
		enabled: false,
		channels: 1,
		values: [30, 35, 40, 1.0] // [channel1, channel2, channel3, intensity]
	};

	function updateTransforms(transform) {
		if (transform === null || transform === undefined) return transforms;
		
		var deferred = Q.defer();
		var promises = [];
		
		var enabled = transform['enabled'];				
		if (transform.hasOwnProperty('channels')) {
			var channels = transform['channels'];
			if (!(channels === 1 || channels === 3))
				deferred.reject("Transform channels must be set to either 1 or 3.");
				
			if (enabled) {
				promises.push(queueUpdate('STransform',channels));
			} else {
				promises.push(queueUpdate('STransform', 0));
			}
		}
		if (transform.hasOwnProperty('values') && (transform['values'] instanceof Array)) {
			var max = pureweb.util.tryParse(pureweb.getFramework().getState().getStateManager().getValue("/IntensityMax"), Number);
			d
			promises.push(queueUpdate('Channel1', transform['values'][0]));
			promises.push(queueUpdate('Channel2', transform['values'][1]));
			promises.push(queueUpdate('Channel3', transform['values'][2]));
			promises.push(queueUpdate('Intensity', transform['values'][3] * max));
		}
		
		Q.all(promises).then(function(){
			transforms = merge(transforms, transform);
			deferred.resolve(transforms);
		});

		return deferred.promise;
	};

	function dumpState() {
		return pureweb.getFramework().getState().getStateManager().state_.xml_;	
	};

	return {
		createSession: createSession,
		close: close,
		joinSession: joinSession,
		attachView: attachView,
		detachView: detachView,
		viewUpdated: null, // callback when a frame rendered
		stalled: null, // callback when tranmission is interrupted
		error: null,
		ready: ready,
		settings: updateSettings,
		volumes: updateVolumes,
		probeMode: /* updateProbeMode, */ null, // currently not exposed in backend pw impl
		displayObjects: updateDisplayObjects,
		transforms: updateTransforms,
		dumpState: dumpState
	};
});