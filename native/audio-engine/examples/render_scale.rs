//! Renders a C major scale (C4..C5) at three loudnesses with the sampled piano
//! and writes it as a 48 kHz 16-bit stereo WAV.
//!
//! `cargo run --release --example render_scale -- out.wav [piano-folder]`
//! Prints the peak (0..1) of each loudness section.

use audio_engine::core::{Command, Mixer};
use audio_engine::piano::SampleBank;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

const RATE: u32 = 48_000;
const SCALE: [u8; 8] = [60, 62, 64, 65, 67, 69, 71, 72];
const VELOCITIES: [(u8, &str); 3] = [(30, "soft"), (70, "medium"), (120, "loud")];

fn main() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let out_path = args.next().ok_or("usage: render_scale <out.wav> [piano folder]")?;
    let folder = args
        .next()
        .map_or_else(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/piano")), PathBuf::from);

    let started = std::time::Instant::now();
    let bank = SampleBank::load_dir(&folder)?;
    println!("loaded {} samples in {:.2} s", bank.len(), started.elapsed().as_secs_f64());

    let mut mixer = Mixer::new(RATE, 2);
    mixer.set_bank(Some(Arc::new(bank)));

    let mut all: Vec<f32> = Vec::new();
    for (velocity, name) in VELOCITIES {
        let mut peak = 0.0f32;
        let mut section = |mixer: &mut Mixer, seconds: f32, all: &mut Vec<f32>| {
            let mut buf = vec![0.0f32; 2 * (RATE as f32 * seconds) as usize];
            mixer.render(&mut buf);
            peak = buf.iter().fold(peak, |p, x| p.max(x.abs()));
            all.extend_from_slice(&buf);
        };
        for note in SCALE {
            mixer.handle(Command::NoteOn { note, velocity, midi_us: 0 });
            section(&mut mixer, 0.5, &mut all);
            mixer.handle(Command::NoteOff { note });
            section(&mut mixer, 0.1, &mut all);
        }
        section(&mut mixer, 1.0, &mut all); // let the last note die away
        println!("{name:>6} (velocity {velocity:>3}): peak {peak:.4}");
    }
    let overall = all.iter().fold(0.0f32, |p, x| p.max(x.abs()));
    println!("overall peak {overall:.4} (must not pass 1.0)");

    write_wav(&out_path, &all).map_err(|e| format!("could not write {out_path}: {e}"))?;
    println!("wrote {out_path} ({:.1} s)", all.len() as f32 / 2.0 / RATE as f32);
    Ok(())
}

/// 16-bit stereo PCM WAV, header written by hand.
fn write_wav(path: &str, samples: &[f32]) -> std::io::Result<()> {
    let data_len = (samples.len() * 2) as u32;
    let mut f = std::io::BufWriter::new(std::fs::File::create(path)?);
    f.write_all(b"RIFF")?;
    f.write_all(&(36 + data_len).to_le_bytes())?;
    f.write_all(b"WAVEfmt ")?;
    f.write_all(&16u32.to_le_bytes())?; // size of the fmt block
    f.write_all(&1u16.to_le_bytes())?; // PCM
    f.write_all(&2u16.to_le_bytes())?; // channels
    f.write_all(&RATE.to_le_bytes())?;
    f.write_all(&(RATE * 4).to_le_bytes())?; // bytes per second
    f.write_all(&4u16.to_le_bytes())?; // bytes per frame
    f.write_all(&16u16.to_le_bytes())?; // bits per sample
    f.write_all(b"data")?;
    f.write_all(&data_len.to_le_bytes())?;
    for s in samples {
        f.write_all(&((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes())?;
    }
    f.flush()
}
