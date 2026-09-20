package com.example.biblioteca.biblioteca.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;

public class LibroDTO {

    private Long id;

    private String titulo;
    private String isbn;
    private LocalDate fechaPublicacion;
    private List<AutorDTO> escritoPors;

    public LibroDTO() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitulo() { return titulo; }
    public void setTitulo(String titulo) { this.titulo = titulo; }
    public String getIsbn() { return isbn; }
    public void setIsbn(String isbn) { this.isbn = isbn; }
    public LocalDate getFechaPublicacion() { return fechaPublicacion; }
    public void setFechaPublicacion(LocalDate fechaPublicacion) { this.fechaPublicacion = fechaPublicacion; }
    public List<AutorDTO> getEscritoPors() { return escritoPors; }
    public void setEscritoPors(List<AutorDTO> escritoPors) { this.escritoPors = escritoPors; }
}
