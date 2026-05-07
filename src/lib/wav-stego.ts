import { BitOutputStream, BitInputStream } from "@thi.ng/bitstream";
import seedrandom from "seedrandom";
import { WavOutputFormat, WAVE, Input, BlobSource, AudioSampleSink, Output, BufferTarget, AudioSampleSource, AudioSample, InputAudioTrack } from "mediabunny";

export interface EncodeResult {
    blob: Blob;
    ranges: [number, number][];
}

const MAGIC = new Uint32Array([0x231, 0x00000000]);

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

async function sequentialSamples(audio: InputAudioTrack): Promise<[number, number][]> {
    const data = await capacities(audio);
    let sum = -data[0];
    return data.map((capacity, index) => {
        const result = [index, sum] as [number, number];
        sum += capacity;
        return result;
    });
}

async function randomSamples(audio: InputAudioTrack, key: string): Promise<[number, number][]> {
    const seed = await hash(key);
    const rng = seedrandom(seed);
    const data = await sequentialSamples(audio);
    shuffle(rng, data);
    return data;
}

export async function encodeLSB(file: File, text: string, key: string | null): Promise<EncodeResult> {
    const audio = await parseAudio(file);
    const sampleRate = await audio.getSampleRate();
    const numChannels = await audio.getNumberOfChannels();


    const textBytes = new TextEncoder().encode(text);
    MAGIC[1] = textBytes.length;
    const sizeInput = new BitInputStream(new Uint8Array(MAGIC.buffer));
    const bitInput = new BitInputStream(textBytes);


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
        const [cdf_index, cdf_bits] = cdf[index++];

        let should_write = true;
        let input: BitInputStream;
        if (cdf_index === 0) {
            input = sizeInput;
        } else if (cdf_bits < bitInput.length) {
            input = bitInput;
            input.seek(cdf_bits);
        } else {
            input = bitInput;
            should_write = false;
        }

        for (let i = 0; i < data.length; i += step) {
            if (input.position >= input.length) {
                if (should_write)
                    ranges.push([chunk.timestamp, chunk.timestamp + i / (sampleRate * numChannels)])
                break;
            }
            data[i] = (data[i] & ~1) | input.readBit();
        }

        if (should_write && input.position < input.length) {
            ranges.push([chunk.timestamp, chunk.timestamp + chunk.duration]);
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

async function parseMagic(audio: InputAudioTrack, cdf: [number, number][]): Promise<number> {
    const sink = new AudioSampleSink(audio);
    let index = 0;
    for await (const chunk of sink.samples()) {
        const [cdf_index, _] = cdf[index++];
        if (cdf_index !== 0) {
            continue;
        }
        const data = chunk2bytes(chunk);
        const step = format2bytes(chunk.format);
        const writer = new BitOutputStream();
        for (let i = 0; i < 8 * MAGIC.byteLength * step; i += step) {
            writer.writeBit(data[i] & 1);
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
    const writer = new BitOutputStream(new Uint8Array(length));



    let index = 0;
    for await (const chunk of sink.samples()) {
        const data = chunk2bytes(chunk);
        const step = format2bytes(chunk.format);
        const [cdf_index, cdf_bits] = cdf[index++];
        if (cdf_index === 0 || cdf_bits >= 8 * length) {
            continue;
        } else {
            writer.seek(cdf_bits);
        }

        for (let i = 0; i < data.length; i += step) {
            if (writer.position < length * 8) {
                writer.writeBit(data[i] & 1);
            }
        }
    }


    return new TextDecoder().decode(writer.bytes());
}
