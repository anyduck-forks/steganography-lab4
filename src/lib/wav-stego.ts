import { BitOutputStream, BitInputStream } from "@thi.ng/bitstream";
import seedrandom from "seedrandom";
import { WavOutputFormat, WAVE, Input, BlobSource, AudioSampleSink, Output, BufferTarget, AudioSampleSource, AudioSample, InputAudioTrack } from "mediabunny";

export interface EncodeResult {
    blob: Blob;
    ranges: [number, number][];
}

const MAGIC = new Uint32Array([0x231, 0x00000000]);
const CHUNK_BITS = 4 * 32; 

function format2bytes(format: string): number {
    switch (format) {
        case 's32':
        case 's32-planar':
        case 'f32':
        case 'f32-planar':
            return 4;
        case 's16':
        case 's16-planar':
            return 2;
        case 'u8':
        case 'u8-planar':
            return 1;
        default:
            throw new Error(`Unsupported format: ${format}`);
    }
}

async function hash(key: string): Promise<string> {
    const data = new TextEncoder().encode(key);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buffer).toString();
}

function shuffle<T>(rng: seedrandom.PRNG, array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export async function capacityLSB(file: File): Promise<number> {
    const audio = await parseAudio(file);
    const data = await capacities(audio);
    return data.reduce((sum, capacity) => sum + capacity, 0) * 8;
}


function chunk2bytes(chunk: AudioSample): Uint8Array {
    const byteLen = chunk.allocationSize({ planeIndex: 0 });
    const data = new Uint8Array(byteLen);
    chunk.copyTo(data, { planeIndex: 0 });
    chunk.close();
    return data;
}

async function parseAudio(file: File): Promise<InputAudioTrack> {
    const input = new Input({
        formats: [WAVE],
        source: new BlobSource(file),
    });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack)
        throw new Error('No audio track found in file.');

    return audioTrack;
}

async function cloneAudio(audio: InputAudioTrack): Promise<[AudioSampleSource, Output<WavOutputFormat, BufferTarget>]> {
    const codec = await audio.getCodec();
    if (!codec)
        throw new Error('Unable to determine audio codec.');

    const output = new Output({
        format: new WavOutputFormat(),
        target: new BufferTarget(),
    });

    const source = new AudioSampleSource({ codec });
    output.addAudioTrack(source);
    await output.start();
    return [source, output] as const;
}

async function capacities(audio: InputAudioTrack): Promise<number[]> {
    const samples = []

    const sink = new AudioSampleSink(audio);
    for await (const packet of sink.samples()) {
        const bytes = packet.allocationSize({ planeIndex: 0 });
        samples.push(bytes / format2bytes(packet.format));
    }

    return samples;
}

async function sequentialSamples(audio: InputAudioTrack): Promise<[number, number[]][]> {
    const capacity = await capacities(audio);
    const result: [number, number[]][] = [];

    let cumulative = 0;
    for (let index = 0; index < capacity.length; index++) {
        const chunks = Math.floor(capacity[index] / CHUNK_BITS);
        const offsets: number[] = [];
        for (let k = 0; k < chunks; k++) {
            offsets.push(cumulative);
            cumulative += CHUNK_BITS;
        }
        result.push([index, offsets]);
    }
    return result;
}

async function randomSamples(audio: InputAudioTrack, key: string): Promise<[number, number[]][]> {
    const seed = await hash(key);
    const rng = seedrandom(seed);
    const data = await sequentialSamples(audio);
    for (const [, offsets] of data) {
        shuffle(rng, offsets);
    }
    shuffle(rng, data);
    return data;
}

function padLength(length: number): number {
    const chunkBytes = CHUNK_BITS / 8;
    return Math.ceil(length / chunkBytes) * chunkBytes;
}


function text2bits(text: string) {
    const textBytes = new TextEncoder().encode(text);
    const length = MAGIC.byteLength + textBytes.length;
    MAGIC[1] = length;
    const buffer = new Uint8Array(padLength(length));
    buffer.set(new Uint8Array(MAGIC.buffer), 0);
    buffer.set(textBytes, MAGIC.byteLength);
    const input = new BitInputStream(buffer);
    return input;
}

export async function encodeLSB(file: File, text: string, key: string | null): Promise<EncodeResult> {
    const audio = await parseAudio(file);
    const sampleRate = await audio.getSampleRate();
    const numChannels = await audio.getNumberOfChannels();
    const input = text2bits(text);

    const [source, output] = await cloneAudio(audio);
    const sink = new AudioSampleSink(audio);

    let cdf;
    if (key) {
        cdf = await randomSamples(audio, key);
    } else {
        cdf = await sequentialSamples(audio);
    }

    const ranges: [number, number][] = [];
    let index = 0;
    for await (const chunk of sink.samples()) {
        const data = chunk2bytes(chunk);
        const step = format2bytes(chunk.format);
        const [_, cdf_offsets] = cdf[index++];
        const chunks = Math.floor(data.length / step / CHUNK_BITS);

        let tempRanges: [number, number][] = [];

        for (let k = 0; k < chunks; k++) {
            const cdf_bits = cdf_offsets[k];
            if (cdf_bits >= input.length)
                continue;
            input.seek(cdf_bits);
            for (let p = 0; p < CHUNK_BITS; p++) {
                const idx = (k * CHUNK_BITS + p) * step;
                data[idx] = (data[idx] & ~1) | input.readBit();
            }
            const chunkDuration = CHUNK_BITS * numChannels / sampleRate
            const chunkStart = chunk.timestamp + k * chunkDuration;
            tempRanges.push([chunkStart, chunkStart+ chunkDuration]);
        }

        if (tempRanges.length === chunks) {
            ranges.push([chunk.timestamp, chunk.timestamp + chunk.duration]);
        } else {
            ranges.push(...tempRanges);
        }


        let sample = new AudioSample({
            ...chunk,
            data: data.buffer,
        });

        await source.add(sample);
        sample.close();
    }

    await output.finalize();
    return {
        blob: new Blob([output.target.buffer!], { type: 'audio/wav' }),
        ranges,
    };
}

async function parseMagic(audio: InputAudioTrack, cdf: [number, number[]][]): Promise<number> {
    const sink = new AudioSampleSink(audio);
    let index = 0;
    for await (const chunk of sink.samples()) {
        const [cdf_index, cdf_offsets] = cdf[index++];
        if (cdf_index !== 0) {
            continue;
        }
        const data = chunk2bytes(chunk);
        const step = format2bytes(chunk.format);
        const chunks = Math.floor(data.length / step / CHUNK_BITS);
        const writer = new BitOutputStream(new Uint8Array(padLength(MAGIC.byteLength)));

        for (let k = 0; k < chunks; k++) {
            const cdf_bits = cdf_offsets[k];
            if (cdf_bits >= 8 * MAGIC.byteLength)
                continue;
            writer.seek(cdf_bits);
            for (let p = 0; p < CHUNK_BITS; p++) {
                const idx = (k * CHUNK_BITS + p) * step;
                writer.writeBit(data[idx] & 1);
            }
        }

        let output = new Uint32Array(writer.bytes().buffer);
        if (output[0] !== MAGIC[0]) {
            throw new Error('No hidden message found in the WAV file.');
        }
        return output[1];
    }
    throw new Error('Failed to read first audio chunk.');
}

export async function decodeLSB(file: File, key: string | null): Promise<string> {
    const audio = await parseAudio(file);
    let cdf;
    if (key) {
        cdf = await randomSamples(audio, key);
    } else {
        cdf = await sequentialSamples(audio);
    }



    const length = await parseMagic(audio, cdf);
    const sink = new AudioSampleSink(audio);
    const writer = new BitOutputStream(new Uint8Array(padLength(length)));



    let index = 0;
    for await (const chunk of sink.samples()) {
        const data = chunk2bytes(chunk);
        const step = format2bytes(chunk.format);
        const [_, offsets] = cdf[index++] as [number, number[]];
        const chunks = Math.floor(data.length / step / CHUNK_BITS);


        for (let k = 0; k < chunks; k++) {
            const cdf_bits = offsets[k];
            if (cdf_bits >= length * 8)
                continue;
            writer.seek(cdf_bits);
            for (let p = 0; p < CHUNK_BITS; p++) {
                const idx = (k * CHUNK_BITS + p) * step;
                writer.writeBit(data[idx] & 1);
            }
        }
    }

    const buffer = writer.bytes().subarray(0, length).subarray(MAGIC.byteLength);
    return new TextDecoder().decode(buffer);
}
