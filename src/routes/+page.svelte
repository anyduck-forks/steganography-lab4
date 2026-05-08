<script lang="ts">
    import { encodeLSB, decodeLSB, capacityLSB } from "$lib/wav-stego";
    import Waveform from "$lib/components/Waveform.svelte";

    let encodeFile = $state<File | null>(null);
    let encodeText = $state<string>("");
    let encodeKey = $state<string>("");
    let useEncodeKey = $state<boolean>(false);
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
    let decodeKey = $state<string>("");
    let useDecodeKey = $state<boolean>(false);
    let decodedText = $state<string>("");
    let decodeError = $state<string>("");

    $effect(() => {
        if (!useEncodeKey) encodeKey = "";
    });

    $effect(() => {
        if (!useDecodeKey) decodeKey = "";
    });

    async function handleEncode() {
        encodeError = "";
        encodedBlob = null;
        if (!encodeFile) {
            encodeError = "Please select a WAV file.";
            return;
        }
        if (!encodeText) {
            encodeError = "Please enter some text to hide.";
            return;
        }
        const key = useEncodeKey ? encodeKey : null;

        try {
            const result = await encodeLSB(encodeFile, encodeText, key);
            ranges = result.ranges;
            encodedBlob = result.blob;
            download(result.blob, "encoded.wav");
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
        const key = useDecodeKey ? decodeKey : null;

        try {
            decodedText = await decodeLSB(decodeFile, key);
        } catch (err: any) {
            decodeError = err.message || "Error occurred during decoding.";
        }
    }

    async function onDecodeFileChange(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        decodeFile = input.files?.[0] || null;
        handleDecode();
    }

    const download = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);

        Object.assign(document.createElement("a"), {
            href: url,
            download: filename,
        }).click();

        URL.revokeObjectURL(url);
    };
</script>

<h1>LSB + PRNG Steganography in Audio</h1>

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

    <input type="checkbox" bind:checked={useEncodeKey} id="use-encode-key" />
    <label for="use-encode-key">Randomize </label>
    <input
        type="text"
        bind:value={encodeKey}
        placeholder="Enter secret key..."
        style="margin-top: var(--pico-spacing);"
        disabled={!useEncodeKey}
    />

    <div class="actions">
        <button onclick={handleEncode}>Encode & Generate WAV</button>
    </div>

    {#if encodeError}
        <p style="color: red;"><strong>Error:</strong> {encodeError}</p>
    {/if}

    {#if encodeFile && encodedBlob}
        <p>Before:</p>
        <Waveform audio={encodeFile} />
        <p>After:</p>
        <Waveform audio={encodedBlob} regions={ranges} />
    {/if}
</details>

<details name="steganography" class="panel">
    <summary>Decode</summary>

    <input type="file" accept="audio/wav" onchange={onDecodeFileChange} />

    <input type="checkbox" bind:checked={useDecodeKey} id="use-decode-key" />
    <label for="use-decode-key">Randomize</label>
    <input
        type="text"
        bind:value={decodeKey}
        oninput={handleDecode}
        placeholder="Enter secret key..."
        style="margin-top: var(--pico-spacing);"
        disabled={!useDecodeKey}
    />

    {#if decodeError}
        <p style="color: red;"><strong>Error:</strong> {decodeError}</p>
    {/if}

    {#if decodedText}
        <label>
            Extracted:
            <textarea readonly rows="8">{decodedText}</textarea>
        </label>
    {/if}
</details>

<style>
    .capacity-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin: 0.5rem 0 1rem 0;
    }
    .capacity-row progress {
        flex-grow: 1;
        margin-bottom: 0;
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
