<script lang="ts">
    import { encodeLSB, decodeLSB, capacityLSB } from "$lib/wav-stego";
    import Waveform from "$lib/components/Waveform.svelte";

    let encodeFile = $state<File | null>(null);
    let encodeText = $state<string>("");
    let downloadUrl = $state<string | null>(null);
    let encodeError = $state<string>("");
    let ranges = $state<[number, number][]>([]);
    let encodedBlob = $state<Blob | null>(null);

    let capacityBits = $state<number>(0);
    const requiredBits = $derived(
        new TextEncoder().encode(encodeText).length * 8,
    );

    const usedCapacityText = $derived.by(() =>
        capacityBits > 0
            ? `${requiredBits} / ${capacityBits}`
            : "No file selected",
    );

    let decodeFile = $state<File | null>(null);
    let decodedText = $state<string>("");
    let decodeError = $state<string>("");

    async function handleEncode() {
        encodeError = "";
        downloadUrl = null;
        encodedBlob = null;
        if (!encodeFile) {
            encodeError = "Please select a WAV file.";
            return;
        }
        if (!encodeText) {
            encodeError = "Please enter some text to hide.";
            return;
        }

        try {
            const result = await encodeLSB(encodeFile, encodeText);
            ranges = result.ranges;
            encodedBlob = result.blob;
            downloadUrl = URL.createObjectURL(result.blob);
        } catch (err: any) {
            encodeError = err.message || "Error occurred during encoding.";
        }
    }

    async function onEncodeFileChange(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        encodeFile = input.files?.[0] || null;
        capacityBits = 0;
        if (encodeFile) {
            try {
                capacityBits = await capacityLSB(encodeFile);
            } catch (err: any) {
                encodeError =
                    err?.message || "Unable to compute capacity for this file.";
            }
        }
    }

    async function handleDecode() {
        decodeError = "";
        decodedText = "";
        if (!decodeFile) {
            decodeError = "Please select a WAV file to decode.";
            return;
        }

        try {
            decodedText = await decodeLSB(decodeFile);
        } catch (err: any) {
            decodeError = err.message || "Error occurred during decoding.";
        }
    }

    async function onDecodeFileChange(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        decodeFile = input.files?.[0] || null;
        if (decodeFile) {
            await handleDecode();
        }
    }
</script>

<h1>LSB Steganography in Audio</h1>

<details open name="steganography" class="panel">
    <summary>Encode</summary>

    <input
        type="file"
        accept="audio/wav"
        onchange={(e) => onEncodeFileChange(e)}
    />

    <textarea
        rows="4"
        bind:value={encodeText}
        placeholder="Enter the text to hide here..."
    ></textarea>

    <div class="capacity-row">
        <progress max={capacityBits} value={requiredBits}></progress>
        <small>{usedCapacityText}</small>
    </div>

    <div class="actions">
        <button onclick={handleEncode}>Encode & Generate WAV</button>
    </div>

    {#if encodeError}
        <p style="color: red;"><strong>Error:</strong> {encodeError}</p>
    {/if}

    {#if downloadUrl && encodeFile && encodedBlob}
        <article class="success">
            <p><strong>Success!</strong> Data has been hidden.</p>
            <a
                href={downloadUrl}
                download="encoded_output.wav"
                role="button"
                class="outline dl-btn"
            >
                Download Encoded WAV
            </a>

            <hr />

            <Waveform audio={encodeFile} />

            <hr />

            <Waveform audio={encodedBlob} regions={ranges} />
        </article>
    {/if}
</details>

<details name="steganography" class="panel">
    <summary>Decode</summary>

    <label>
        Encoded WAV File:
        <input
            type="file"
            accept="audio/wav"
            onchange={(e) => onDecodeFileChange(e)}
        />
    </label>

    {#if decodeError}
        <p style="color: red;"><strong>Error:</strong> {decodeError}</p>
    {/if}

    {#if decodedText}
        <article>
            <header><strong>Extracted Secret:</strong></header>
            <blockquote>{decodedText}</blockquote>
        </article>
    {/if}
</details>

<style>
    .success {
        border-left: 4px solid #10b981;
        background-color: var(--pico-card-background-color);
    }
    .dl-btn {
        margin-bottom: 1rem;
        display: inline-block;
    }
    .panel {
        margin: 1rem 0;
        padding: 1rem;
        /* border: 1px solid var(--pico-border-color); */
        border-radius: 6px;
        /* background: var(--pico-card-background-color); */
    }
    .capacity-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin: 0.5rem 0 1rem 0;
    }
    .capacity-row progress {
        flex-grow: 1;
    }
    .capacity-row small {
        white-space: nowrap;
        margin-left: 0.5rem;
        flex-shrink: 0;
    }
    .actions {
        margin: 0.5rem 0 1rem 0;
    }
</style>
