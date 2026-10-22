module SpaceAGORAVisualizer

using Base64
using JSON

export CONTRACT_VERSION, PAYLOAD_SCHEMA_VERSION, CompatibilityError, require_version
export validate_payload, viewer_directory, viewer_import_map, render_viewer_html, visualize

const CONTRACT_VERSION = 1
const PAYLOAD_SCHEMA_VERSION = 1

"""An unsupported renderer contract, viewer payload, or scene schema version."""
struct CompatibilityError <: Exception
    contract::String
    received::Any
    supported::Int
end
Base.showerror(io::IO, e::CompatibilityError) = print(io,
    "Unsupported ", e.contract, " version ", repr(e.received),
    "; SpaceAGORAVisualizer supports version ", e.supported, ".")

function _require_version(name::String, received, supported::Int)
    received isa Integer && !(received isa Bool) && received == supported ||
        throw(CompatibilityError(name, received, supported))
    return nothing
end

"""
    require_version(version)

Require renderer service contract version 1. No files are read or written.
"""
require_version(version) = _require_version("renderer contract", version, CONTRACT_VERSION)

function _required(object::AbstractDict, key::String, owner::String)
    haskey(object, key) || throw(ArgumentError("Missing $owner.$key in viewer payload."))
    return object[key]
end

function _record(object::AbstractDict, key::String, owner::String)
    value = _required(object, key, owner)
    value isa AbstractDict || throw(ArgumentError("$owner.$key must be a JSON object."))
    return value
end

function _count(frames::AbstractDict, key::String; minimum::Int=0)
    value = _required(frames, key, "frames")
    value isa Integer && !(value isa Bool) && value >= minimum ||
        throw(ArgumentError("frames.$key must be an integer >= $minimum."))
    return Int(value)
end

function _block_length(value, dtype::String, expected::Int, name::String)
    dtype in ("f32", "f64") || throw(ArgumentError("$name has unsupported dtype $dtype."))
    if value isa AbstractString
        bytes = try
            base64decode(value)
        catch
            throw(ArgumentError("$name must be a valid base64 float block."))
        end
        length(bytes) == expected * (dtype == "f64" ? 8 : 4) ||
            throw(ArgumentError("$name does not match its declared frame dimensions."))
    elseif value isa AbstractVector
        length(value) == expected && all(x -> x isa Real && !(x isa Bool), value) ||
            throw(ArgumentError("$name must contain $expected numeric values."))
    else
        throw(ArgumentError("$name must be a base64 float block or numeric array."))
    end
    return nothing
end

# A float block's values: base64 little-endian Float64, or a numeric array.
function _float64_values(value, expected::Int, name::String)::Vector{Float64}
    _block_length(value, "f64", expected, name)
    value isa AbstractString && return collect(reinterpret(Float64, base64decode(value)))
    return Float64[Float64(x) for x in value]
end

# The optional interlinks block: a run's link schedule as links and the windows
# over which each was active and, when recorded, in contact. Validate its
# structure; the windows' times are not resampled or reconciled.
function _validated_interlinks(block, sats::Int)
    block === nothing && return nothing
    block isa AbstractDict || throw(ArgumentError("interlinks must be a JSON object."))
    _require_version("interlinks block", get(block, "schema", nothing), 1)
    links = _required(block, "links", "interlinks")
    links isa AbstractVector || throw(ArgumentError("interlinks.links must be an array."))
    for link in links
        link isa AbstractDict || throw(ArgumentError("interlinks.links entries must be JSON objects."))
        for key in ("a", "b")
            value = _required(link, key, "interlinks.links[]")
            value isa Integer && !(value isa Bool) && 1 <= value <= sats ||
                throw(ArgumentError("interlinks.links[].$key must be a spacecraft number in 1:$sats."))
        end
        _required(link, "kind", "interlinks.links[]") isa AbstractString ||
            throw(ArgumentError("interlinks.links[].kind must be a string."))
        _required(link, "directed", "interlinks.links[]") isa Bool ||
            throw(ArgumentError("interlinks.links[].directed must be true or false."))
    end
    for name in ("active", "contact")
        windows = name == "active" ? _required(block, name, "interlinks") : get(block, name, nothing)
        windows === nothing && continue
        windows isa AbstractDict || throw(ArgumentError("interlinks.$name must be a JSON object or null."))
        count = _required(windows, "count", "interlinks.$name")
        count isa Integer && !(count isa Bool) && count >= 0 ||
            throw(ArgumentError("interlinks.$name.count must be an integer >= 0."))
        index = _required(windows, "index", "interlinks.$name")
        index isa AbstractVector && length(index) == count &&
            all(i -> i isa Integer && !(i isa Bool) && 0 <= i < length(links), index) ||
            throw(ArgumentError("interlinks.$name.index must hold $count positions in interlinks.links."))
        starts = _float64_values(_required(windows, "start_s", "interlinks.$name"), Int(count), "interlinks.$name.start_s")
        ends = _float64_values(_required(windows, "end_s", "interlinks.$name"), Int(count), "interlinks.$name.end_s")
        all(isfinite, starts) && all(isfinite, ends) && all(starts .<= ends) ||
            throw(ArgumentError("interlinks.$name windows must have finite times with start_s <= end_s."))
    end
    return block
end

# Mission history is optional plain data shared with the independent viewer.
# Validate structure without changing times, names or the underlying results.
function _validated_mission_history(mission)
    mission === nothing && return nothing
    mission isa AbstractDict || throw(ArgumentError("mission must be a JSON object."))
    schema = get(mission, "schema", nothing)
    schema isa Integer && !(schema isa Bool) && schema == 1 ||
        throw(ArgumentError("Unsupported mission history schema; expected 1."))
    name_ok(x) = x isa AbstractString && !isempty(strip(x))
    time_ok(x) = x isa Real && !(x isa Bool) && isfinite(x) && x >= 0
    name_ok(get(mission, "name", nothing)) || throw(ArgumentError("mission.name must be a nonempty string."))
    segments = get(mission, "segments", nothing)
    transitions = get(mission, "transitions", nothing)
    segments isa AbstractVector || throw(ArgumentError("mission.segments must be an array."))
    transitions isa AbstractVector || throw(ArgumentError("mission.transitions must be an array."))
    names = Set{String}()
    for (i, segment) in enumerate(segments)
        segment isa AbstractDict || throw(ArgumentError("mission segment must be an object."))
        name = get(segment, "name", nothing)
        name_ok(name) && !(name in names) || throw(ArgumentError("Mission segment names must be nonempty and unique."))
        push!(names, name)
        start_s, end_s = get(segment, "start_s", nothing), get(segment, "end_s", nothing)
        time_ok(start_s) && time_ok(end_s) && start_s <= end_s ||
            throw(ArgumentError("Mission segment times must be finite and satisfy 0 <= start_s <= end_s."))
        i == 1 || segments[i - 1]["end_s"] == start_s ||
            throw(ArgumentError("Mission segment intervals must be contiguous and ordered."))
    end
    n = length(segments)
    (n == 0 ? isempty(transitions) : length(transitions) in (n - 1, n)) ||
        throw(ArgumentError("Mission history needs one transition per adjacent segment and an optional final exit."))
    for (i, transition) in enumerate(transitions)
        transition isa AbstractDict || throw(ArgumentError("mission transition must be an object."))
        t = get(transition, "time_s", nothing)
        time_ok(t) && t == segments[i]["end_s"] ||
            throw(ArgumentError("Mission transition time must match its segment boundary."))
        get(transition, "from", nothing) == segments[i]["name"] ||
            throw(ArgumentError("Mission transition.from must name its outgoing segment."))
        haskey(transition, "to") && transition["to"] == (i < n ? segments[i + 1]["name"] : nothing) ||
            throw(ArgumentError("Mission transition.to must name the next segment, or be null at final exit."))
        name_ok(get(transition, "reason", nothing)) ||
            throw(ArgumentError("Mission transition.reason must be a nonempty string."))
    end
    return mission
end

"""
    validate_payload(payload) -> payload

Validate the supported file contract before rendering. New payloads declare
`viewer_schema = 1`; historical payloads without that field are accepted as
version 1 only when their `scene.schema` is 1. Time/position block dimensions
must match the declared frame and spacecraft counts. The optional `mission` and
`interlinks` blocks are checked when present. This function does not
resample, convert, mutate, or scientifically validate the saved results.
"""
function validate_payload(payload::AbstractDict)
    _require_version("viewer payload", get(payload, "viewer_schema", 1), PAYLOAD_SCHEMA_VERSION)
    scene = _record(payload, "scene", "payload")
    _require_version("scene schema", _required(scene, "schema", "scene"), 1)
    _record(scene, "planet", "scene")
    spacecraft = _required(scene, "spacecraft", "scene")
    spacecraft isa AbstractVector || throw(ArgumentError("scene.spacecraft must be an array."))
    frames = _record(payload, "frames", "payload")
    count = _count(frames, "count")
    sats = _count(frames, "sats"; minimum=1)
    length(spacecraft) == sats || throw(ArgumentError("scene spacecraft count differs from frames.sats."))
    _block_length(_required(frames, "t_s", "frames"), String(get(frames, "t_dtype", "f32")), count, "frames.t_s")
    _block_length(_required(frames, "pos_km", "frames"), String(get(frames, "pos_dtype", "f32")), Base.checked_mul(Base.checked_mul(count, sats), 3), "frames.pos_km")
    _validated_mission_history(get(payload, "mission", nothing))
    _validated_interlinks(get(payload, "interlinks", nothing), sats)
    return payload
end

include("render.jl")

"""Return the package-owned renderer asset directory; performs no writes."""
viewer_directory()::String = VIEWER_DIR

"""
    render_viewer_html(payload; viewer_dir=VIEWER_DIR, title="SpaceAGORA viewer") -> String

Validate a version-1 viewer payload and assemble a self-contained HTML page.
The renderer and vendored JavaScript are embedded; data and display options
are preserved. External URLs already present in models may still be loaded
by the browser. This method performs no simulation or network requests.
"""
function render_viewer_html(payload::AbstractDict; viewer_dir::AbstractString=VIEWER_DIR,
        title::AbstractString="SpaceAGORA viewer")::String
    validate_payload(payload)
    return _render_viewer_html(payload; viewer_dir, title)
end

function _payload_path(input::AbstractString)::String
    path = abspath(input)
    if isdir(path)
        conventional = joinpath(path, "simulation_results_viewer.json")
        isfile(conventional) && return conventional
        candidates = sort(filter(p -> endswith(p, "_viewer.json") && isfile(p), readdir(path; join=true)))
        length(candidates) == 1 && return only(candidates)
        isempty(candidates) && throw(ArgumentError("No *_viewer.json payload in $path. Export a viewer payload from SpaceAGORA first; a scene sidecar or Arrow file alone is not a viewer payload."))
        throw(ArgumentError("Several viewer payloads exist in $path; pass the desired JSON file explicitly."))
    end
    if isfile(path)
        endswith(lowercase(path), ".json") || throw(ArgumentError("Expected an exported viewer JSON payload, not $path. Export a viewer payload from SpaceAGORA first."))
        return path
    end
    candidate = path * "_viewer.json"
    isfile(candidate) && return candidate
    throw(ArgumentError("No viewer payload at $path or $candidate. Pass an exported *_viewer.json file, its results prefix, or its run directory."))
end

function _write_html(path::String, html::String)
    mkpath(dirname(path))
    temporary, io = mktemp(dirname(path))
    try
        write(io, html)
        close(io)
        mv(temporary, path; force=true)
    finally
        isopen(io) && close(io)
        isfile(temporary) && rm(temporary; force=true)
    end
    return path
end

"""
    visualize(input; out=nothing, title="SpaceAGORA viewer", viewer_dir=VIEWER_DIR) -> String

Render an exported viewer JSON file, a results prefix (`*_viewer.json`), or a
run directory. A directory selects `simulation_results_viewer.json` when present;
otherwise it must contain exactly one `*_viewer.json`. The default output is
next to the payload with `.html` replacing `.json`. Returns its absolute path.

This package does not decode Arrow results or construct a scene from simulation
configuration. Core exports that information into the portable viewer payload.
"""
function visualize(input::AbstractString; out::Union{Nothing,AbstractString}=nothing,
        title::AbstractString="SpaceAGORA viewer", viewer_dir::AbstractString=VIEWER_DIR)::String
    path = _payload_path(input)
    payload = JSON.parsefile(path)
    payload isa AbstractDict || throw(ArgumentError("Viewer payload must be a JSON object."))
    output = out === nothing ? splitext(path)[1] * ".html" : abspath(out)
    isdir(output) && throw(ArgumentError("HTML output must name a file, not a directory: $output"))
    same = normpath(output) == normpath(path) || (ispath(output) && samefile(output, path))
    same && throw(ArgumentError("HTML output must not overwrite the input viewer payload."))
    html = render_viewer_html(payload; viewer_dir, title)
    return _write_html(output, html)
end

end # module SpaceAGORAVisualizer
