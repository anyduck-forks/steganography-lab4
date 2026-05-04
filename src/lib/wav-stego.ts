import { BitOutputStream, BitInputStream } from "@thi.ng/bitstream";


import { WavOutputFormat, WAVE, Input, BlobSource, AudioBufferSink,AudioSampleSink, Output, BufferTarget, AudioSampleSource, AudioSample, EncodedPacketSink } from "mediabunny";

    
export interface EncodeResult {
    blob: Blob;
    ranges: [number, number][];
}

const EOF = '\0\0\0\0';


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


export async function capacityLSB(file: File): Promise<number> {
    const input = new Input({
        formats: [WAVE],
        source: new BlobSource(file),
    });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack)
        throw new Error('No audio track found in file.');

    const sampleRate = await audioTrack.getSampleRate();
    const numChannels = await audioTrack.getNumberOfChannels();
    const duration = await audioTrack.computeDuration();
    // const v2 = await audioTrack.getDurationFromMetadata();  
    const availableBits = Math.floor(duration * sampleRate) * numChannels;


    // const sink = new EncodedPacketSink(audioTrack);
    // for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    //     console.log(`Processed packet: ${JSON.stringify(packet)} frames, timestamp ${packet.timestamp}ms`);	// ...
    // }
    return availableBits;
}


function chunk2bytes(chunk: AudioSample): Uint8Array {
    const byteLen = chunk.allocationSize({ planeIndex: 0 });
    const data = new Uint8Array(byteLen);
    chunk.copyTo(data, { planeIndex: 0 });
    chunk.close();
    return data;
}

export async function encodeLSB(file: File, text: string): Promise<EncodeResult> {
    const input = new Input({
        formats: [WAVE],
        source: new BlobSource(file),
    });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack)
        throw new Error('No audio track found in file.');

    const sampleRate = await audioTrack.getSampleRate();
    const numChannels = await audioTrack.getNumberOfChannels();
    const duration = await audioTrack.computeDuration();
    const v2 = await audioTrack.getDurationFromMetadata();

    const textBytes = new TextEncoder().encode(text + EOF);
    const requiredBits = textBytes.length * 8;
    const availableBits = Math.floor(duration * sampleRate) * numChannels;
    const codec = await audioTrack.getCodec();
    if (!codec) throw new Error('Unable to determine audio codec.');
    console.log(audioTrack.getCodec());
    if (requiredBits > availableBits) {
        throw new Error(`WAV file is too small. Need ${requiredBits} bits, but only have ${availableBits}.`);
    }

    const bitInput = new BitInputStream(textBytes);
    const mask = ~1;

    const output = new Output({
        format: new WavOutputFormat(),
        target: new BufferTarget(),
    });

    const source = new AudioSampleSource({ codec });
    output.addAudioTrack(source);
    await output.start();

    const sink = new AudioSampleSink(audioTrack);

    for await (const chunk of sink.samples()) {
        const data = chunk2bytes(chunk);
    
        for (let i = 0; i < data.length; i+=format2bytes(chunk.format)) {
            if (bitInput.position >= bitInput.length)
                break;
            data[i] = (data[i] & mask) |  bitInput.readBit();
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
        ranges: [[0, bitInput.length / (sampleRate * numChannels)]],
    };
}

export async function decodeLSB(file: File): Promise<string> {
    const input = new Input({
        formats: [WAVE],
        source: new BlobSource(file),
    });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error('No audio track found in file.');

    const sink = new AudioSampleSink(audioTrack);
    const writer = new BitOutputStream();
    let found = false;

    outer:
    for await (const chunk of sink.samples()) {
        const data = new Uint8Array(chunk.allocationSize({ planeIndex: 0 }));
        chunk.copyTo(data, { planeIndex: 0 });
        chunk.close();

        for (let i = 0; i < data.length; i+=format2bytes(chunk.format)) {
            writer.writeBit(data[i] & 1);

            if (writer.position % 8 === 0 && ends(writer, EOF)) {
                found = true;
                break outer;
            }
        }
    }

    if (!found) {
        throw new Error('No hidden message found in the WAV file.');
    }

    const pad = writer.bytes();
    const raw = pad.slice(0, pad.length - EOF.length);
    return new TextDecoder().decode(raw);
}


function ends(haystack: BitOutputStream, eof: string): boolean {
    const needle = Uint8Array.from(eof, c => c.charCodeAt(0));
    const length = Math.ceil(haystack.position / 8);
    
    if (needle.length > length)
        return false;
    
    const target = haystack.buffer.subarray(length - needle.length, length);
    return needle.every((byte, i) => target[i] === byte);
}