package com.example.biblioteca.biblioteca.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;
import com.fasterxml.jackson.annotation.JsonIgnore;

public class AutorDTO {

    private Long id;

    private String nombre;
    @JsonIgnore
    private List<LibroDTO> libros;

    public AutorDTO() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getNombre() { return nombre; }
    public void setNombre(String nombre) { this.nombre = nombre; }
    public List<LibroDTO> getLibros() { return libros; }
    public void setLibros(List<LibroDTO> libros) { this.libros = libros; }
}
