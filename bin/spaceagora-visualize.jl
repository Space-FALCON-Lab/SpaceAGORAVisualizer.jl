#!/usr/bin/env julia
using SpaceAGORAVisualizer

function main(args)
    isempty(args) && error("Usage: julia --project=. bin/spaceagora-visualize.jl <viewer.json|run directory|results prefix> [output.html]")
    length(args) <= 2 || error("Expected an input and optional output HTML path.")
    path = visualize(args[1]; out=length(args) == 2 ? args[2] : nothing)
    println(path)
    return nothing
end
main(ARGS)
