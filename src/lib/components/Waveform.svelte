<script module lang="ts">
    import WaveSurfer from 'wavesurfer.js';
    
    let zoom = $state(100);
    let instances = $state<WaveSurfer[]>([]);

    function sync(source: WaveSurfer | null, f: (ws: WaveSurfer) => void) {
        for (const ws of instances.filter(ws => ws !== source)) f(ws);
    }

    export function syncZoom(source: WaveSurfer, newZoom: number) {
        if (zoom === newZoom) return;
        zoom = newZoom;
        sync(source, ws => ws.zoom(newZoom));
    }

    export function syncScroll(source: WaveSurfer | null, newScroll: number) {
        sync(source, ws => ws.setScroll(newScroll));
    }

    export function syncPlay(source: WaveSurfer) {
        sync(source, ws => ws.pause());
        source.play();
    }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
  import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.esm.js';
  import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.esm.js';

  let { audio, regions = [] } = $props<{
      audio: Blob | File, 
      regions?: [number, number][]
  }>();

  let wsInstance = $state<WaveSurfer | null>(null);
  let waveDiv: HTMLDivElement;
  let minimapDiv: HTMLDivElement;

  function handlePointerDown(e: PointerEvent) {
      const div = e.currentTarget as HTMLDivElement;
      div.setPointerCapture(e.pointerId);

      function scroll(event: PointerEvent) {
          if (!wsInstance) return;
          const { left, width } = div.getBoundingClientRect();
          let p = (event.clientX - left) / width;
          p = Math.max(0, Math.min(1, p));
          
          const wrapper = wsInstance.getWrapper();
          const totalWidth = wrapper.clientWidth || 1;
          const visibleWidth = wsInstance.getWidth();
          
          // Center the visible area (overlay) on the pointer position
          syncScroll(null, p * totalWidth - visibleWidth / 2);
      }

      scroll(e);

      div.addEventListener('pointermove', scroll);
      div.addEventListener('pointerup', () => {
          div.removeEventListener('pointermove', scroll);
          div.releasePointerCapture(e.pointerId);
      }, { once: true });
  }

  onMount(() => {
    const wsRegions = RegionsPlugin.create();
    const wsMinimap = MinimapPlugin.create({
      height: 20,
      waveColor: '#ddd',
      progressColor: '#999',
      container: minimapDiv,
      interact: false 
    });
    const wsZoom = ZoomPlugin.create({
      scale: 0.5,
      maxZoom: 1000
    });
    const ws = WaveSurfer.create({
      container: waveDiv,
      waveColor: '#2d84db',
      progressColor: '#1d5a96',
      height: 100,
      minPxPerSec: zoom,
      hideScrollbar: true, 
      autoCenter: false,
      plugins: [wsRegions, wsMinimap, wsZoom]
    });

    wsInstance = ws;
    instances.push(ws);

    ws.on('decode', () => {
      wsRegions.clearRegions();
      for (const [start, end] of regions) {
        wsRegions.addRegion({
          start,
          end,
          color: 'rgba(255, 99, 132, 0.4)',
          drag: false,
          resize: false
        });
      }
    });

    ws.on('click', () =>  syncPlay(ws));
    ws.on('zoom', (newZoom) => syncZoom(ws, newZoom));
    ws.on('timeupdate', () => syncScroll(ws, ws.getScroll()));

    return () => {
      instances = instances.filter(w => w !== ws);
      ws.destroy();
      wsInstance = null;
    };
  });

  $effect(() => {
    if (wsInstance && audio) {
        wsInstance.loadBlob(audio);
    }
  });
</script>

<div class="waveform-container">
  <div bind:this={waveDiv}></div>
  
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    bind:this={minimapDiv} 
    style="margin-top: 0.5rem; cursor: pointer;"
    onpointerdown={handlePointerDown}
  ></div>
</div>

<style>
  .waveform-container {
      margin-bottom: 2rem;
  }
</style>
