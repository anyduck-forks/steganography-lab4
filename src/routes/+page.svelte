<script lang="ts">
  import { encodeLSB, decodeLSB } from '$lib/wav-stego';
  import Waveform from '$lib/components/Waveform.svelte';

  let encodeFile: File | null = $state(null);
  let encodeText: string = $state('');
  let downloadUrl: string | null = $state(null);
  let encodeError: string = $state('');
  let ranges: [number, number][] = $state([]);
  let encodedBlob: Blob | null = $state(null);

  let decodeFile: File | null = $state(null);
  let decodedText: string = $state('');
  let decodeError: string = $state('');

  async function handleEncode() {
    encodeError = '';
    downloadUrl = null;
    encodedBlob = null;
    if (!encodeFile) {
      encodeError = 'Please select a WAV file.';
      return;
    }
    if (!encodeText) {
      encodeError = 'Please enter some text to hide.';
      return;
    }

    try {
      const result = await encodeLSB(encodeFile, encodeText);
      ranges = result.ranges;
      encodedBlob = result.blob;
      downloadUrl = URL.createObjectURL(result.blob);
    } catch (err: any) {
      encodeError = err.message || 'Error occurred during encoding.';
    }
  }

  async function handleDecode() {
    decodeError = '';
    decodedText = '';
    if (!decodeFile) {
      decodeError = 'Please select a WAV file to decode.';
      return;
    }

    try {
      decodedText = await decodeLSB(decodeFile);
    } catch (err: any) {
      decodeError = err.message || 'Error occurred during decoding.';
    }
  }
</script>

<article>
  <header><h1>Lab 4: LSB Steganography in Audio</h1></header>
  
  <div class="grid">
    <!-- Encoding Section -->
    <div>
      <h2>Encode (Hide Data)</h2>
      <label>
        Original WAV File:
        <input type="file" accept="audio/wav" onchange={(e) => encodeFile = e.currentTarget.files?.[0] || null} />
      </label>
      
      <label>
        Secret Text:
        <textarea rows="4" bind:value={encodeText} placeholder="Enter the text to hide here..."></textarea>
      </label>

      <button onclick={handleEncode}>Encode & Generate WAV</button>

      {#if encodeError}
        <p style="color: red;"><strong>Error:</strong> {encodeError}</p>
      {/if}

      {#if downloadUrl && encodeFile && encodedBlob}
        <article class="success">
          <p><strong>Success!</strong> Data has been hidden.</p>
          <a href={downloadUrl} download="encoded_output.wav" role="button" class="outline dl-btn">
            Download Encoded WAV
          </a>
          <hr />
          
          <Waveform 
            audio={encodeFile} 
          />
          
          <hr />

          <Waveform 
            audio={encodedBlob} 
            regions={ranges} 
          />

        </article>
      {/if}
    </div>

    <!-- Decoding Section -->
    <div>
      <h2>Decode (Extract Data)</h2>
      <label>
        Encoded WAV File:
        <input type="file" accept="audio/wav" onchange={(e) => decodeFile = e.currentTarget.files?.[0] || null} />
      </label>

      <button class="secondary" onclick={handleDecode}>Extract Hidden Text</button>

      {#if decodeError}
        <p style="color: red;"><strong>Error:</strong> {decodeError}</p>
      {/if}

      {#if decodedText}
        <article>
          <header><strong>Extracted Secret:</strong></header>
          <blockquote>{decodedText}</blockquote>
        </article>
      {/if}
    </div>
  </div>
</article>

<style>
  .success {
    border-left: 4px solid #10b981;
    background-color: var(--pico-card-background-color);
  }
  .dl-btn {
      margin-bottom: 1rem;
      display: inline-block;
  }
</style>
