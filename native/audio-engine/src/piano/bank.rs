//! The sample bank: names to notes, loading, trimming, lookup and loudness.

use std::path::Path;

/// Velocity layers we ship (Salamander layers 4, 8, 12 and 16).
pub const LAYERS: usize = 4;
/// Longest kept sample, seconds.
pub const MAX_SECONDS: u32 = 10;
/// Fade at the cut, seconds.
pub const CUT_FADE_SECONDS: u32 = 1;
/// Furthest a key may be pitched away from its sample (1.5 semitones, so 2
/// when counting whole semitones with a tie rounded up).
pub const MAX_SHIFT: i32 = 2;

/// One recorded note: interleaved stereo i16.
pub struct Sample {
    pub note: u8,
    /// Layer index 0..LAYERS (0 = softest).
    pub layer: u8,
    pub sample_rate: u32,
    /// Channels in the source file (mono files are stored as stereo).
    pub source_channels: u8,
    data: Box<[i16]>,
}

impl Sample {
    pub fn new(note: u8, layer: u8, sample_rate: u32, source_channels: u8, data: Vec<i16>) -> Self {
        Self { note, layer, sample_rate, source_channels, data: data.into_boxed_slice() }
    }

    /// Interleaved L, R.
    pub fn data(&self) -> &[i16] {
        &self.data
    }

    pub fn frames(&self) -> usize {
        self.data.len() / 2
    }

    pub fn seconds(&self) -> f64 {
        self.frames() as f64 / f64::from(self.sample_rate.max(1))
    }
}

/// Which sample a key plays and how far it is pitched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Choice {
    /// Index into `SampleBank::samples()`.
    pub sample: usize,
    /// Key minus sample note (positive: the sample is played faster).
    pub semitones: i8,
    /// The layer the sample really comes from (can differ from the one asked
    /// for when that layer has no sample in range).
    pub layer: u8,
}

/// All samples plus lookup tables. Built once, then only read.
pub struct SampleBank {
    samples: Vec<Sample>,
    /// `map[asked layer][key]`.
    map: [[Option<Choice>; 128]; LAYERS],
    /// RMS (0..1) of the first 0.3 s of each sample.
    rms: Vec<f32>,
    /// Per sample: its loudest layer's RMS (same note) divided by its own.
    norm: Vec<f32>,
}

impl std::fmt::Debug for SampleBank {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SampleBank({} samples)", self.samples.len())
    }
}

/// `A0v4.ogg`, `D#4v16.ogg` -> (MIDI note, layer index). C4 = 60, A0 = 21.
pub fn parse_file_name(name: &str) -> Option<(u8, u8)> {
    let stem = name.strip_suffix(".ogg")?;
    let (note_part, layer_part) = stem.split_once('v')?;
    let mut chars = note_part.chars();
    let pitch_class: u8 = match chars.next()? {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let rest = chars.as_str();
    let (sharp, octave) = match rest.strip_prefix('#') {
        Some(o) => (1, o),
        None => (0, rest),
    };
    if octave.len() != 1 {
        return None;
    }
    let octave: u8 = octave.parse().ok()?;
    let note = 12 * (u16::from(octave) + 1) + u16::from(pitch_class + sharp);
    if !(21..=108).contains(&note) {
        return None;
    }
    let layer = match layer_part.parse::<u8>().ok()? {
        4 => 0,
        8 => 1,
        12 => 2,
        16 => 3,
        _ => return None,
    };
    Some((note as u8, layer))
}

/// Velocity 1-40 -> layer 0, 41-72 -> 1, 73-100 -> 2, 101-127 -> 3.
pub fn layer_for_velocity(velocity: u8) -> usize {
    match velocity {
        0..=40 => 0,
        41..=72 => 1,
        73..=100 => 2,
        _ => 3,
    }
}

/// Cut to `MAX_SECONDS`, fade the end to exactly 0 (1 s when cut, 5 ms when
/// the sample ended by itself). `data` is interleaved stereo.
pub(crate) fn trim_and_fade(data: &mut Vec<i16>, sample_rate: u32) {
    let sr = sample_rate.max(1) as usize;
    let max_frames = sr * MAX_SECONDS as usize;
    let cut = data.len() / 2 > max_frames;
    if cut {
        data.truncate(max_frames * 2);
    }
    let frames = data.len() / 2;
    let fade = if cut { sr * CUT_FADE_SECONDS as usize } else { (sr * 5 / 1000).max(1) }.min(frames);
    for i in 0..fade {
        let k = (fade - 1 - i) as f32 / fade as f32;
        let at = (frames - fade + i) * 2;
        data[at] = (f32::from(data[at]) * k) as i16;
        data[at + 1] = (f32::from(data[at + 1]) * k) as i16;
    }
}

impl SampleBank {
    pub fn from_samples(samples: Vec<Sample>) -> Self {
        let rms: Vec<f32> = samples.iter().map(sample_rms).collect();
        let norm: Vec<f32> = samples
            .iter()
            .zip(&rms)
            .map(|(s, &own)| {
                let reference = samples.iter().zip(&rms).filter(|(o, _)| o.note == s.note).map(|(_, &r)| r).fold(0.0f32, f32::max);
                if own > 0.0 && reference > 0.0 {
                    reference / own
                } else {
                    1.0
                }
            })
            .collect();
        let mut map = [[None; 128]; LAYERS];
        for (asked, row) in map.iter_mut().enumerate() {
            // Layers in order of distance from the one asked for.
            let mut order: Vec<usize> = (0..LAYERS).collect();
            order.sort_by_key(|l| (l.abs_diff(asked), *l));
            for (key, slot) in row.iter_mut().enumerate() {
                *slot = order.iter().find_map(|&layer| nearest(&samples, layer, key as i32));
            }
        }
        Self { samples, map, rms, norm }
    }

    /// Decode every `*.ogg` in `dir` that parses as a sample name.
    pub fn load_dir(dir: &Path) -> Result<Self, String> {
        let read = std::fs::read_dir(dir).map_err(|e| format!("Could not read the piano sound folder {}: {e}", dir.display()))?;
        let mut files: Vec<(std::path::PathBuf, u8, u8)> = read
            .filter_map(Result::ok)
            .filter_map(|e| {
                let (note, layer) = parse_file_name(e.file_name().to_str()?)?;
                Some((e.path(), note, layer))
            })
            .collect();
        if files.is_empty() {
            return Err(format!("No piano sounds found in {}.", dir.display()));
        }
        files.sort();
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, 8);
        // Interleaved chunks so every thread gets a similar mix of notes.
        let results: Vec<Result<Sample, String>> = std::thread::scope(|scope| {
            let files = &files;
            let handles: Vec<_> = (0..threads)
                .map(|t| {
                    scope.spawn(move || {
                        files
                            .iter()
                            .skip(t)
                            .step_by(threads)
                            .map(|(path, note, layer)| decode_file(path, *note, *layer))
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            handles.into_iter().flat_map(|h| h.join().unwrap_or_else(|_| vec![Err("A piano loading thread stopped.".to_string())])).collect()
        });
        let mut samples = Vec::with_capacity(results.len());
        for r in results {
            samples.push(r?);
        }
        samples.sort_by_key(|s| (s.layer, s.note));
        Ok(Self::from_samples(samples))
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    pub fn samples(&self) -> &[Sample] {
        &self.samples
    }

    /// The sample for `key` at the asked layer. No allocation.
    pub fn choose(&self, layer: usize, key: u8) -> Option<Choice> {
        self.map[layer.min(LAYERS - 1)].get(usize::from(key)).copied().flatten()
    }

    /// Gain for `sample` (an index from `choose`) at `velocity`.
    ///
    /// The velocity curve `g(v)` (see `core::velocity`) says how loud a key
    /// should be. Layers are recorded at different loudness, and that differs
    /// from note to note, so every sample is normalised by itself:
    ///
    /// `gain = g(v) * rms(loudest layer of this note) / rms(this sample)`
    ///
    /// with `rms` taken over the first 0.3 s. The heard loudness is
    /// `gain * rms(this sample) = g(v) * rms(loudest layer of this note)`, the
    /// same for every layer of a note, so across a layer boundary it only
    /// follows the curve (0.3 dB per velocity step) with no jump, for every
    /// key. At velocity 127 the loudest layer plays at unity.
    pub fn gain(&self, sample: usize, velocity: u8) -> f32 {
        crate::core::velocity::gain(velocity) * self.norm.get(sample).copied().unwrap_or(1.0)
    }

    /// Heard loudness (RMS of the first 0.3 s, 0..1) of `sample` at `velocity`.
    pub fn loudness(&self, sample: usize, velocity: u8) -> f32 {
        self.gain(sample, velocity) * self.rms.get(sample).copied().unwrap_or(0.0)
    }
}

/// RMS (0..1) of the first 0.3 s of a stereo sample.
fn sample_rms(s: &Sample) -> f32 {
    let n = s.frames().min(s.sample_rate as usize * 3 / 10);
    if n == 0 {
        return 0.0;
    }
    let energy: f64 = s.data()[..n * 2].iter().map(|&v| f64::from(v) * f64::from(v)).sum();
    ((energy / (n * 2) as f64).sqrt() / 32768.0) as f32
}

/// The sample of `layer` closest to `key`, if within `MAX_SHIFT`.
fn nearest(samples: &[Sample], layer: usize, key: i32) -> Option<Choice> {
    let mut best: Option<(i32, usize)> = None;
    for (i, s) in samples.iter().enumerate().filter(|(_, s)| usize::from(s.layer) == layer) {
        let d = key - i32::from(s.note);
        if d.abs() <= MAX_SHIFT && best.is_none_or(|(bd, _)| d.abs() < bd.abs()) {
            best = Some((d, i));
        }
    }
    best.map(|(d, i)| Choice { sample: i, semitones: d as i8, layer: layer as u8 })
}

/// Decode one OGG file to stereo i16, trimmed and faded.
fn decode_file(path: &Path, note: u8, layer: u8) -> Result<Sample, String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
    let fail = |e: &dyn std::fmt::Display| format!("Could not read the piano sound {name}: {e}");
    let file = std::io::BufReader::new(std::fs::File::open(path).map_err(|e| fail(&e))?);
    let mut reader = lewton::inside_ogg::OggStreamReader::new(file).map_err(|e| fail(&e))?;
    let channels = usize::from(reader.ident_hdr.audio_channels);
    let sample_rate = reader.ident_hdr.audio_sample_rate;
    if channels == 0 || sample_rate == 0 {
        return Err(fail(&"empty header"));
    }
    let want_frames = sample_rate as usize * MAX_SECONDS as usize + 1;
    let mut data: Vec<i16> = Vec::with_capacity(want_frames.min(sample_rate as usize * 12) * 2);
    while data.len() / 2 < want_frames {
        match reader.read_dec_packet_itl().map_err(|e| fail(&e))? {
            Some(packet) => {
                for frame in packet.chunks_exact(channels) {
                    data.push(frame[0]);
                    data.push(if channels == 1 { frame[0] } else { frame[1] });
                }
            }
            None => break,
        }
    }
    if data.is_empty() {
        return Err(fail(&"no audio"));
    }
    trim_and_fade(&mut data, sample_rate);
    Ok(Sample::new(note, layer, sample_rate, channels.min(2) as u8, data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::piano::testing::{grid_bank, sine_sample};

    const REAL: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/piano");

    #[test]
    fn file_names_become_note_and_layer() {
        assert_eq!(parse_file_name("A0v4.ogg"), Some((21, 0)));
        assert_eq!(parse_file_name("C8v16.ogg"), Some((108, 3)));
        assert_eq!(parse_file_name("D#4v16.ogg"), Some((63, 3)));
        assert_eq!(parse_file_name("F#7v12.ogg"), Some((102, 2)));
        assert_eq!(parse_file_name("C4v8.ogg"), Some((60, 1)));
    }

    #[test]
    fn bad_file_names_are_rejected() {
        for n in ["CREDITS.md", "C4v8.wav", "H4v8.ogg", "C4v5.ogg", "C4.ogg", "v8.ogg", "C9v8.ogg", "G#0v8.ogg", "C#8v8.ogg", "C4v20.ogg", ".ogg", ""] {
            assert_eq!(parse_file_name(n), None, "{n}");
        }
    }

    #[test]
    fn layers_follow_the_velocity_ranges() {
        let expect = [(1, 0), (40, 0), (41, 1), (72, 1), (73, 2), (100, 2), (101, 3), (127, 3), (0, 0)];
        for (v, l) in expect {
            assert_eq!(layer_for_velocity(v), l, "velocity {v}");
        }
    }

    #[test]
    fn every_key_has_a_sample_within_two_semitones() {
        let bank = grid_bank(0.05);
        for layer in 0..LAYERS {
            for key in 21..=108u8 {
                let c = bank.choose(layer, key).unwrap_or_else(|| panic!("no sample for {key}"));
                assert!(i32::from(c.semitones).abs() <= 2, "key {key} is {} away", c.semitones);
                assert_eq!(i32::from(key) - i32::from(bank.samples()[c.sample].note), i32::from(c.semitones));
                assert_eq!(usize::from(c.layer), layer);
            }
        }
    }

    #[test]
    fn keys_too_far_from_any_sample_get_none() {
        let bank = grid_bank(0.05);
        assert!(bank.choose(0, 15).is_none());
        assert!(bank.choose(0, 127).is_none());
        assert!(bank.choose(9, 60).is_some(), "a layer number past the end counts as the top layer");
    }

    #[test]
    fn a_missing_layer_falls_back_to_the_nearest_layer_that_has_samples() {
        let bank = SampleBank::from_samples(vec![sine_sample(60, 2, 261.6, 0.5, 0.05)]);
        for layer in 0..LAYERS {
            let c = bank.choose(layer, 61).unwrap();
            assert_eq!((c.sample, c.semitones, c.layer), (0, 1, 2));
        }
    }

    #[test]
    fn loudness_at_each_layer_boundary_matches_the_velocity_curve() {
        let bank = grid_bank(0.5);
        let loud = |v: u8, key: u8| {
            let c = bank.choose(layer_for_velocity(v), key).unwrap();
            bank.loudness(c.sample, v)
        };
        for key in [21u8, 60, 108] {
            for (a, b) in [(40u8, 41u8), (72, 73), (100, 101)] {
                let got = loud(b, key) / loud(a, key);
                let want = crate::core::velocity::gain(b) / crate::core::velocity::gain(a);
                assert!((got / want - 1.0).abs() < 0.01, "key {key} boundary {a}/{b}: {got} vs {want}");
            }
        }
        // The loudest layer of a note at velocity 127 is at unity.
        let c = bank.choose(3, 60).unwrap();
        assert!((bank.gain(c.sample, 127) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_single_layer_bank_just_uses_the_velocity_curve() {
        let bank = SampleBank::from_samples(vec![sine_sample(60, 0, 261.6, 0.3, 0.5)]);
        let g = bank.gain(0, 64);
        assert!((g - crate::core::velocity::gain(64)).abs() < 1e-6);
    }

    #[test]
    fn long_samples_are_cut_to_ten_seconds_and_faded_to_zero() {
        let mut d = vec![1000i16; 2 * 48_000 * 12];
        trim_and_fade(&mut d, 48_000);
        assert_eq!(d.len(), 2 * 48_000 * 10);
        assert_eq!(&d[d.len() - 2..], &[0, 0]);
        assert_eq!(d[2 * 48_000 * 9 - 2], 1000, "fade starts one second before the cut");
        let mid = d[2 * (48_000 * 9 + 24_000)];
        assert!((mid - 500).abs() < 5, "halfway through the fade {mid}");
        assert!(d.windows(4).all(|w| w[2] <= w[0]), "fade never rises");
    }

    #[test]
    fn short_samples_keep_their_length_and_end_on_zero() {
        let mut d = vec![1000i16; 2 * 48_000 * 2];
        trim_and_fade(&mut d, 48_000);
        assert_eq!(d.len(), 2 * 48_000 * 2);
        assert_eq!(&d[d.len() - 2..], &[0, 0]);
        assert_eq!(d[d.len() / 2], 1000, "only the last few ms are touched");
    }

    #[test]
    fn the_real_piano_folder_loads_120_samples_in_under_5_seconds() {
        let t = std::time::Instant::now();
        let bank = SampleBank::load_dir(Path::new(REAL)).expect("load");
        let took = t.elapsed();
        println!("LOAD TIME {:.2} s ({} samples)", took.as_secs_f64(), bank.len());
        assert_eq!(bank.len(), 120);
        for s in bank.samples() {
            assert_eq!(s.sample_rate, 48_000);
            assert_eq!(s.source_channels, 2);
            assert!(s.seconds() <= 10.0 + 1e-9, "note {} is {} s", s.note, s.seconds());
            assert!(s.frames() > 0);
            assert_eq!(&s.data()[s.data().len() - 2..], &[0, 0], "note {} layer {}", s.note, s.layer);
        }
        for layer in 0..LAYERS {
            for key in 21..=108u8 {
                assert!(bank.choose(layer, key).is_some());
            }
        }
        if !cfg!(debug_assertions) {
            assert!(took.as_secs_f64() < 5.0, "loading took {took:?}");
        }
    }

    #[test]
    fn a_folder_without_samples_is_an_error_with_a_plain_message() {
        let e = SampleBank::load_dir(Path::new("/definitely/not/here")).err().unwrap();
        assert!(e.contains("piano"), "{e}");
    }

    fn db(a: f32, b: f32) -> f32 {
        20.0 * (a / b).log10()
    }

    #[test]
    fn on_the_real_samples_loudness_is_even_across_layer_boundaries_and_never_falls_with_velocity() {
        let bank = SampleBank::load_dir(Path::new(REAL)).expect("load");
        for key in 21..=108u8 {
            let loud = |v: u8| {
                let c = bank.choose(layer_for_velocity(v), key).unwrap();
                bank.loudness(c.sample, v)
            };
            for (a, b) in [(40u8, 41u8), (72, 73), (100, 101)] {
                let jump = db(loud(b), loud(a));
                assert!(jump.abs() <= 1.0, "key {key}: velocity {a} to {b} jumps {jump:.2} dB");
            }
            for v in 1..127u8 {
                let step = db(loud(v + 1), loud(v));
                assert!(step >= -0.5, "key {key}: velocity {} is {:.2} dB quieter than {v}", v + 1, -step);
            }
        }
    }
}
